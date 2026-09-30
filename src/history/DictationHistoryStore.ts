import type { DictationRecord } from "@/history/dictation";
import type { DictationsApi } from "@/services/dictationsService";
import { createId as newId } from "@/sync/createId";
import type {
  TranscriptDeliveryResult,
  TranscriptDestinationId,
} from "@/voice/transcript/TranscriptDestination";

export const DICTATION_HISTORY_LIMIT = 75;
const STORAGE_KEY = "dictation.history.v1";

type HistoryStorage = Pick<Storage, "getItem" | "setItem">;

export interface DictationHistoryEntry {
  /** Missing on rows saved before cloud sync. Those stay on this device. */
  id?: string;
  text: string;
  timestamp: string;
  destination: TranscriptDestinationId;
  outcome: "success" | "failure";
}

export interface DictationHistorySnapshot {
  entries: DictationHistoryEntry[];
  error: string | null;
}

function isDestination(value: unknown): value is TranscriptDestinationId {
  return value === "active-field" || value === "voice-note" || value === "send-to-device";
}

function parseEntry(value: unknown): DictationHistoryEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.text !== "string"
    || typeof entry.timestamp !== "string"
    || Number.isNaN(Date.parse(entry.timestamp))
    || !isDestination(entry.destination)
    || (entry.outcome !== "success" && entry.outcome !== "failure")
  ) {
    return null;
  }
  const id = typeof entry.id === "string" && entry.id.length > 0 ? entry.id : undefined;
  return {
    id,
    text: entry.text,
    timestamp: entry.timestamp,
    destination: entry.destination,
    outcome: entry.outcome,
  };
}

function fromRecord(record: DictationRecord): DictationHistoryEntry {
  return {
    id: record.id,
    text: record.text,
    timestamp: record.createdAt,
    destination: record.destination,
    outcome: record.outcome,
  };
}

/** Newest first. A remote row replaces the local row with the same id. Rows without an id stay. */
export function mergeHistory(
  local: readonly DictationHistoryEntry[],
  remote: readonly DictationRecord[],
  limit: number,
): DictationHistoryEntry[] {
  const byId = new Map<string, DictationHistoryEntry>();
  const withoutId: DictationHistoryEntry[] = [];
  for (const entry of local) {
    if (entry.id) byId.set(entry.id, entry);
    else withoutId.push(entry);
  }
  for (const record of remote) byId.set(record.id, fromRecord(record));
  return [...byId.values(), ...withoutId]
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, limit);
}

/**
 * Finalized dictation history. Always local. When the account has opted in, new entries
 * are also inserted into `dictations` without delaying delivery.
 */
export class DictationHistoryStore {
  private snapshot: DictationHistorySnapshot;
  private listeners = new Set<() => void>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly limit: number;
  private userId: string | null = null;
  private cloudSync = false;
  /** Bumped when the account changes so a late insert cannot report an error for the next user. */
  private generation = 0;
  /** Ids recorded while sync was on. Existing local rows are never added here. */
  private pendingUpload = new Set<string>();
  private uploads: Promise<void> = Promise.resolve();

  constructor(
    private storage: HistoryStorage,
    limit = DICTATION_HISTORY_LIMIT,
    private now: () => Date = () => new Date(),
    private api: DictationsApi | null = null,
    private sourceDeviceId: (userId: string) => string = () => "",
    private createId: () => string = newId,
  ) {
    this.limit = Math.max(1, Math.floor(limit));
    this.snapshot = this.load();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DictationHistorySnapshot => this.snapshot;

  /** Call with the signed-in user's id (or `null`) whenever it changes. */
  setUser(userId: string | null): void {
    if (userId === this.userId) return;
    this.userId = userId;
    this.generation += 1;
    this.pendingUpload.clear();
  }

  /** Mirrors the account opt-in. Turning it on does not upload history already on this device. */
  setCloudSync(enabled: boolean): void {
    this.cloudSync = enabled;
    if (!enabled) this.pendingUpload.clear();
  }

  /** Resolves once every queued cloud insert has finished. Delivery does not wait on this. */
  settled(): Promise<void> {
    return this.uploads;
  }

  /**
   * Shows the entry immediately, then writes storage after delivery returns.
   * Storage and cloud failures stay inside the deferred write and cannot change the destination outcome.
   */
  recordLater(result: TranscriptDeliveryResult): void {
    this.prepend(result);
    this.schedulePersist();
  }

  /**
   * Picks up an entry written while this view was in the background.
   * When cloud sync is on, also merges the account's newest dictations.
   */
  reload(): Promise<void> {
    if (!this.cloudSync || !this.userId || !this.api) {
      this.reloadLocal();
      return Promise.resolve();
    }
    return this.reloadCloud();
  }

  record(result: TranscriptDeliveryResult): void {
    this.prepend(result);
    this.flush();
  }

  clear(): void {
    this.cancelPersist();
    this.pendingUpload.clear();
    this.snapshot = { entries: [], error: null };
    this.emit();
    this.write(this.snapshot.entries);
  }

  private load(): DictationHistorySnapshot {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return { entries: [], error: null };
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return { entries: [], error: "Recent history could not be loaded." };
      const entries = parsed
        .map(parseEntry)
        .filter((entry): entry is DictationHistoryEntry => entry !== null)
        .slice(0, this.limit);
      return { entries, error: null };
    } catch {
      return { entries: [], error: "Recent history could not be loaded." };
    }
  }

  private reloadLocal(): void {
    const stored = this.load();
    const currentHead = this.snapshot.entries[0]?.timestamp ?? "";
    const storedHead = stored.entries[0]?.timestamp ?? "";
    if (storedHead < currentHead) return;
    const sameList = storedHead === currentHead && stored.entries.length === this.snapshot.entries.length;
    if (sameList && stored.error === this.snapshot.error) return;
    this.snapshot = stored;
    this.emit();
  }

  private async reloadCloud(): Promise<void> {
    const userId = this.userId;
    const api = this.api;
    if (!userId || !api) return;
    const generation = this.generation;
    try {
      const remote = await api.list(userId);
      if (generation !== this.generation || !this.cloudSync || this.userId !== userId) return;
      const entries = mergeHistory(this.snapshot.entries, remote, this.limit);
      this.snapshot = { entries, error: null };
      this.emit();
      this.write(entries);
    } catch (reason) {
      if (generation !== this.generation) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      this.snapshot = { entries: this.snapshot.entries, error: message };
      this.emit();
    }
  }

  private prepend(result: TranscriptDeliveryResult): void {
    const entry: DictationHistoryEntry = {
      id: this.createId(),
      ...result,
      timestamp: this.now().toISOString(),
    };
    if (this.cloudSync && this.userId && entry.id) this.pendingUpload.add(entry.id);
    this.snapshot = {
      entries: [entry, ...this.snapshot.entries].slice(0, this.limit),
      error: this.snapshot.error,
    };
    this.emit();
  }

  /** Coalesces storage writes so a burst of dictations persists the latest list once. */
  private schedulePersist(): void {
    if (this.persistTimer !== null) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.write(this.snapshot.entries);
    }, 0);
  }

  private flush(): void {
    this.cancelPersist();
    this.write(this.snapshot.entries);
  }

  private cancelPersist(): void {
    if (this.persistTimer === null) return;
    clearTimeout(this.persistTimer);
    this.persistTimer = null;
  }

  private write(entries: DictationHistoryEntry[]): void {
    let error: string | null = null;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      error = "Recent history could not be saved on this device.";
    }
    if (this.snapshot.entries !== entries) {
      this.schedulePersist();
      return;
    }
    if (error !== this.snapshot.error) {
      this.snapshot = { entries: this.snapshot.entries, error };
      this.emit();
    }
    this.drainUploads(entries);
  }

  /** Uploads only entries recorded while sync was already on. Failures stay on the local list. */
  private drainUploads(entries: readonly DictationHistoryEntry[]): void {
    const userId = this.userId;
    const api = this.api;
    if (!this.cloudSync || !userId || !api) return;
    const generation = this.generation;
    for (const id of [...this.pendingUpload]) {
      const entry = entries.find((item) => item.id === id);
      this.pendingUpload.delete(id);
      if (!entry?.id) continue;
      const text = entry.text.trim();
      if (!text) continue;
      const record: DictationRecord = {
        id: entry.id,
        text,
        destination: entry.destination,
        outcome: entry.outcome,
        sourceDeviceId: this.sourceDeviceId(userId),
        createdAt: entry.timestamp,
      };
      this.uploads = this.uploads.then(async () => {
        try {
          await api.insert(userId, record);
        } catch (reason) {
          if (generation !== this.generation) return;
          const message = reason instanceof Error ? reason.message : String(reason);
          if (this.snapshot.error === message) return;
          this.snapshot = { entries: this.snapshot.entries, error: message };
          this.emit();
        }
      });
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
