import type { AssistantStatus } from "@/assistant/state";
import { localUsageDay, splitAssistantActivity, type AssistantUsageEvent, type AssistantUsageModality, type AssistantUsageEnd } from "@/usage/assistantUsage";
import type { AssistantUsageApi } from "@/services/assistantUsageService";

const MAX_PENDING = 500;
const INACTIVITY_MS = 5 * 60_000;
const MAX_RESPONSE_ACTIVITY_MS = 60_000;
const BASE_TURN_ACTIVITY_MS = 1_000;

type Session = { id: string; conversationId: string | null; lastAt: number; lastUserAt: number | null };
export interface AssistantUsageScope {
  userId: string | null;
  deviceId: string | null;
  epoch: number;
  enabled: boolean;
}

/**
 * One interaction session spans Live reconnects but not explicit stops or long
 * gaps. Records only sanitized metadata; never holds user/model text.
 */
export class AssistantUsageStore {
  private scope: AssistantUsageScope = { userId: null, deviceId: null, epoch: 0, enabled: false };
  private active: Session | null = null;
  private pending: AssistantUsageEvent[] = [];
  private flushing = false;
  private listeners = new Set<() => void>();

  constructor(
    private readonly api: AssistantUsageApi,
    private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
    private readonly now: () => number = () => Date.now(),
    private readonly uuid: () => string = () => crypto.randomUUID(),
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(): void { for (const listener of this.listeners) listener(); }
  private storageKey(s: AssistantUsageScope): string {
    return `assistant.usage.pending.v1.${s.userId}.${s.epoch}`;
  }

  setScope(next: AssistantUsageScope): void {
    const same = JSON.stringify(next) === JSON.stringify(this.scope);
    if (same) return;
    const previous = this.scope;
    const changed = previous.userId !== next.userId || previous.epoch !== next.epoch ||
      previous.deviceId !== next.deviceId || !next.enabled;
    if (changed) {
      this.active = null;
      this.pending = [];
      if (previous.userId && (!next.enabled || previous.userId !== next.userId || previous.epoch !== next.epoch)) {
        this.storage.removeItem(this.storageKey(previous));
      }
    }
    this.scope = { ...next, enabled: !!next.enabled && !!next.userId && !!next.deviceId };
    if (this.scope.enabled && changed) {
      try {
        const stored: unknown = JSON.parse(this.storage.getItem(this.storageKey(this.scope)) ?? "[]");
        if (Array.isArray(stored)) {
          this.pending = stored.filter((e): e is AssistantUsageEvent =>
            !!e && typeof e === "object" && e.epoch === next.epoch &&
            typeof e.id === "string" && typeof e.deviceId === "string" &&
            e.deviceId === next.deviceId && typeof e.kind === "string").slice(0, MAX_PENDING);
        }
      } catch { this.pending = []; }
    }
    this.publish();
    this.flush();
  }

  isEnabled(): boolean { return this.scope.enabled; }

  private enqueue(kind: AssistantUsageEvent["kind"], at: number, attributes: {
    modality?: AssistantUsageModality; durationMs?: number; endReason?: AssistantUsageEnd; localDay?: string;
  } = {}): void {
    const s = this.active, scope = this.scope;
    if (!s || !scope.enabled || !scope.deviceId) return;
    const event: AssistantUsageEvent = {
      id: this.uuid(), sessionId: s.id, conversationId: s.conversationId,
      deviceId: scope.deviceId, epoch: scope.epoch, occurredAt: new Date(at).toISOString(),
      localDay: attributes.localDay ?? localUsageDay(new Date(at)),
      kind, modality: attributes.modality ?? null,
      durationMs: attributes.durationMs ?? null, endReason: attributes.endReason ?? null,
    };
    this.pending.push(event);
    if (this.pending.length > MAX_PENDING) this.pending.splice(0, this.pending.length - MAX_PENDING);
    this.persist();
    this.publish();
    this.flush();
  }

  private persist(): void {
    if (this.scope.enabled) {
      try { this.storage.setItem(this.storageKey(this.scope), JSON.stringify(this.pending)); } catch { /* no payloads retained elsewhere */ }
    }
  }

  recordTurn(input: { id: string; role: "user" | "assistant"; modality?: AssistantUsageModality }, conversationId: string | null): void {
    if (!this.scope.enabled) return;
    const at = this.now();
    if (!this.active && input.role !== "user") return;
    if (this.active && at - this.active.lastAt > INACTIVITY_MS) {
      this.endSession("idle", this.active.lastAt + INACTIVITY_MS);
      if (input.role !== "user") return;
    }
    if (!this.active) {
      this.active = { id: this.uuid(), conversationId, lastAt: at, lastUserAt: null };
      this.enqueue("session_started", at);
    }
    const session = this.active!;
    if (input.role === "user") {
      session.lastUserAt = at;
      this.enqueue("user_turn", at, { modality: input.modality ?? "unknown" });
      this.enqueue("active_interval", at, { durationMs: BASE_TURN_ACTIVITY_MS });
    } else {
      this.enqueue("assistant_turn", at);
      if (session.lastUserAt !== null && at >= session.lastUserAt && at - session.lastUserAt <= INACTIVITY_MS) {
        const duration = Math.min(MAX_RESPONSE_ACTIVITY_MS, at - session.lastUserAt);
        const from = new Date(at - duration);
        for (const part of splitAssistantActivity(from, new Date(at))) {
          this.enqueue("active_interval", Date.parse(part.at), { durationMs: part.durationMs, localDay: part.day });
        }
      }
      session.lastUserAt = null;
    }
    session.lastAt = at;
  }

  onStatus(status: AssistantStatus): void {
    if (status === "IDLE") this.endSession("explicit");
    else if (status === "ERROR") this.endSession("error");
  }

  endSession(reason: AssistantUsageEnd = "explicit", at = this.now()): void {
    if (!this.active) return;
    const ended = Math.max(this.active.lastAt, at);
    this.enqueue("session_ended", ended, { endReason: reason });
    this.active = null;
  }

  /** Synchronous, generation-checked queue; server upsert is idempotent by event UUID. */
  flush(): void {
    if (this.flushing || !this.scope.enabled || !this.scope.userId || !this.pending.length) return;
    const scope = { ...this.scope };
    this.flushing = true;
    void (async () => {
      try {
        while (this.pending.length && JSON.stringify(scope) === JSON.stringify(this.scope)) {
          const event = this.pending[0]!;
          await this.api.write(event, scope.userId!);
          if (JSON.stringify(scope) !== JSON.stringify(this.scope)) break;
          if (this.pending[0]?.id === event.id) this.pending.shift();
          this.persist();
          this.publish();
        }
      } catch { /* kept for retry when the account reconnects or Analytics opens */ }
      finally { this.flushing = false; }
    })();
  }
}
