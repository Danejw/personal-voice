import type { PlatformName } from "@/platform/PlatformAdapter";
import type { PersonalSyncApi } from "@/services/personalSyncService";
import { localDeviceId, readPersonalCache, writePersonalCache } from "@/sync/personalCache";
import type { KeyValueStorage } from "@/sync/personalCache";
import {
  EMPTY_PERSONAL_DATA, MAX_ENABLED_TERMS, enabledCount, isLanguageCode, newTermProblem, normalizeTerm, sortTerms,
} from "@/sync/personalData";
import type { PersonalData, SyncedSettings } from "@/sync/personalData";
import { createId as newId } from "@/sync/createId";

/**
 * - `signed-out`: nothing to sync.
 * - `loading`: showing the cached copy (if any) while Supabase answers.
 * - `synced`: matches Supabase as of the last load or write; edits are allowed.
 * - `offline`: Supabase was unreachable; showing the cached copy read-only.
 */
export type SyncStatus = "signed-out" | "loading" | "synced" | "offline";

export interface SyncSnapshot {
  status: SyncStatus;
  data: PersonalData;
  /** Last load or save failure, shown without blocking dictation. */
  error: string | null;
}

/** A declarative edit, so it can be re-applied to the confirmed copy after an earlier write fails. */
interface Mutation {
  apply(data: PersonalData): PersonalData;
  write(api: PersonalSyncApi, userId: string): Promise<void>;
}

const DEVICE_NAMES: Record<PlatformName, string> = { windows: "Windows", android: "Android" };

/**
 * Account settings and dictionary: load on sign-in, save on change, cache the last confirmed copy.
 * Edits show immediately and are written in order; a failed write rolls the view back to what the
 * server holds (plus edits still in flight). There is no offline queue and no realtime channel.
 */
export class PersonalSyncStore {
  private snapshot: SyncSnapshot = { status: "signed-out", data: EMPTY_PERSONAL_DATA, error: null };
  private listeners = new Set<() => void>();
  private userId: string | null = null;
  /** Bumped per account switch so late responses for a previous account are dropped. */
  private generation = 0;
  private confirmed: PersonalData = EMPTY_PERSONAL_DATA;
  private pending: Mutation[] = [];
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private api: PersonalSyncApi,
    private storage: KeyValueStorage,
    private platform: PlatformName,
    private createId: () => string = newId,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SyncSnapshot => this.snapshot;

  /** Call with the signed-in user's id (or `null`) whenever it changes. */
  async setUser(userId: string | null): Promise<void> {
    if (userId === this.userId) return;
    this.userId = userId;
    this.generation += 1;
    this.pending = [];
    if (!userId) {
      this.confirmed = EMPTY_PERSONAL_DATA;
      this.publish({ status: "signed-out", data: EMPTY_PERSONAL_DATA, error: null });
      return;
    }
    this.confirmed = readPersonalCache(this.storage, userId) ?? EMPTY_PERSONAL_DATA;
    this.publish({ status: "loading", data: this.confirmed, error: null });
    this.touchDevice(userId);
    await this.load();
  }

  /** Re-reads everything from Supabase, e.g. after coming back online. */
  async reload(): Promise<void> {
    if (!this.userId || this.pending.length) return;
    this.publish({ ...this.snapshot, status: "loading", error: null });
    await this.load();
  }

  /** Resolves once every queued write has finished. */
  settled(): Promise<void> {
    return this.writes;
  }

  updateSettings(patch: Partial<Omit<SyncedSettings, "usageEpoch">>): string | null {
    if (patch.language && !isLanguageCode(patch.language)) return "That language code isn't valid.";
    // The whole row is sent so the last write from any device wins as a unit.
    const settings = { ...this.snapshot.data.settings, ...patch };
    return this.enqueue({
      apply: (data) => ({ ...data, settings: { ...data.settings, ...patch } }),
      write: (api, userId) => api.saveSettings(userId, settings),
    });
  }

  /** Returns why the term was refused, or `null` once it is shown and being saved. */
  addTerm(raw: string): string | null {
    const term = normalizeTerm(raw);
    const problem = newTermProblem(term, this.snapshot.data.terms);
    if (problem) return problem;
    const entry = { id: this.createId(), term, enabled: true, createdAt: new Date().toISOString() };
    return this.enqueue({
      apply: (data) => ({ ...data, terms: sortTerms([...data.terms.filter((item) => item.id !== entry.id), entry]) }),
      write: (api, userId) => api.insertTerm(userId, entry),
    });
  }

  setTermEnabled(id: string, enabled: boolean): string | null {
    const terms = this.snapshot.data.terms;
    const current = terms.find((entry) => entry.id === id);
    if (!current || current.enabled === enabled) return null;
    if (enabled && enabledCount(terms) >= MAX_ENABLED_TERMS) {
      return `${MAX_ENABLED_TERMS} terms are already active. Turn one off first.`;
    }
    return this.enqueue({
      apply: (data) => ({ ...data, terms: data.terms.map((entry) => entry.id === id ? { ...entry, enabled } : entry) }),
      write: (api) => api.setTermEnabled(id, enabled),
    });
  }

  removeTerm(id: string): string | null {
    return this.enqueue({
      apply: (data) => ({ ...data, terms: data.terms.filter((entry) => entry.id !== id) }),
      write: (api) => api.deleteTerm(id),
    });
  }

  private enqueue(mutation: Mutation): string | null {
    const userId = this.userId;
    if (!userId || this.snapshot.status !== "synced") return "Changes can be saved once sync is connected.";
    const generation = this.generation;
    this.pending.push(mutation);
    this.publish({ ...this.snapshot, data: mutation.apply(this.snapshot.data), error: null });
    this.writes = this.writes.then(async () => {
      if (generation !== this.generation) return;
      let error: string | null = null;
      try {
        await mutation.write(this.api, userId);
      } catch (reason) {
        error = reason instanceof Error ? reason.message : String(reason);
      }
      if (generation !== this.generation) return;
      this.pending.shift();
      if (error) {
        this.publish({ ...this.snapshot, data: this.pending.reduce((data, next) => next.apply(data), this.confirmed), error });
        return;
      }
      this.confirmed = mutation.apply(this.confirmed);
      writePersonalCache(this.storage, userId, this.confirmed);
    });
    return null;
  }

  private async load(): Promise<void> {
    const userId = this.userId;
    if (!userId) return;
    const generation = this.generation;
    try {
      const data = await this.api.load(userId);
      if (generation !== this.generation) return;
      this.confirmed = { ...data, terms: sortTerms(data.terms) };
      writePersonalCache(this.storage, userId, this.confirmed);
      this.publish({ status: "synced", data: this.confirmed, error: null });
    } catch (reason) {
      if (generation !== this.generation) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      this.publish({ status: "offline", data: this.confirmed, error: `${message} Using the last saved copy.` });
    }
  }

  /** Device metadata is best-effort: a failure must not block settings or dictation. */
  private touchDevice(userId: string): void {
    const device = {
      id: localDeviceId(this.storage, userId, this.createId),
      name: DEVICE_NAMES[this.platform],
      platform: this.platform,
    };
    void this.api.touchDevice(userId, device).catch(() => undefined);
  }

  private publish(next: SyncSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
