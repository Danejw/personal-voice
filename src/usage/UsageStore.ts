import type { PlatformName } from "@/platform/PlatformAdapter";
import { CLEAN_DAY_KEEP, applyUsageEvent, cloneCounters, emptyCounters, parseCounters } from "@/usage/usageEvents";
import type {
  LegacyUsage,
  RemoteUsageDay,
  UsageCounters,
  UsageDay,
  UsageEvent,
  UsageSnapshot,
  UsageTrigger,
} from "@/usage/usageEvents";

const STORAGE_KEY = "usage.days.v1";
const LEGACY_KEY = "usage.totals.v1";
const STORAGE_VERSION = 1;

type UsageStorage = Pick<Storage, "getItem" | "setItem"> & { removeItem?: (key: string) => void };

export interface UsageDayWrite {
  deviceId: string;
  day: string;
  epoch: number;
  revision: number;
  updatedAt: string;
  counters: UsageCounters;
}

export interface UsageApi {
  upsertDay(day: UsageDayWrite): Promise<void>;
  clear(): Promise<number>;
  /** `range` omitted pages the whole history. */
  fetchDays(range?: { from: string; to: string }): Promise<RemoteUsageDay[]>;
}

interface StoredFile {
  version: number;
  epoch: number;
  days: UsageDay[];
}

/** Local daily rollups. Sync failures stay inside this store. */
export class UsageStore {
  private days = new Map<string, UsageDay>();
  private remote: RemoteUsageDay[] = [];
  private legacy: LegacyUsage | null = null;
  private epoch = 0;
  private deviceId: string | null = null;
  private enabled = true;
  private ready = true;
  private error: string | null = null;
  private pendingTrigger: UsageTrigger | null = null;
  private buffer: UsageEvent[] = [];
  private listeners = new Set<() => void>();
  private inflight = new Set<string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private generation = 0;
  /** Stable for `useSyncExternalStore` until the next `publish`. */
  private cached: UsageSnapshot | null = null;

  constructor(
    private storage: UsageStorage,
    private platform: PlatformName,
    private now: () => Date = () => new Date(),
    private api: UsageApi | null = null,
    private debounceMs = 250,
  ) {
    this.load();
    this.cached = this.buildSnapshot();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): UsageSnapshot => this.cached ?? (this.cached = this.buildSnapshot());

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** The next `dictation_started` copies this trigger, then clears it. */
  armTrigger(trigger: UsageTrigger): void {
    this.pendingTrigger = trigger;
  }

  /** Copies and clears the trigger armed by the start source. */
  consumeTrigger(): UsageTrigger | null {
    const trigger = this.pendingTrigger;
    this.pendingTrigger = null;
    return trigger;
  }

  /** Drops other epochs and holds new events until `adoptRemote` runs. */
  beginBootstrap(epoch: number, deviceId: string): void {
    this.deviceId = deviceId;
    this.applyEpoch(epoch);
    this.ready = false;
    this.publish();
  }

  /** Seeds missing or clean-stale days, then applies events that waited. */
  adoptRemote(rows: readonly RemoteUsageDay[]): void {
    for (const row of rows) {
      if (row.epoch !== this.epoch) continue;
      if (this.deviceId && row.deviceId !== this.deviceId) continue;
      const local = this.days.get(row.day);
      if (!local || local.dirty) continue;
      if (row.revision > local.revision) this.days.set(row.day, remoteAsLocal(row));
    }
    for (const row of rows) {
      if (row.epoch !== this.epoch || (this.deviceId && row.deviceId !== this.deviceId)) continue;
      if (!this.days.has(row.day)) this.days.set(row.day, remoteAsLocal(row));
    }
    this.ready = true;
    const waiting = this.buffer.splice(0);
    for (const event of waiting) this.apply(event);
    this.prune();
    this.persist();
    this.publish();
  }

  setRemote(rows: readonly RemoteUsageDay[]): void {
    this.remote = rows.map((row) => ({ ...row, counters: parseCounters(row.counters) }));
    this.publish();
  }

  recordLater(event: UsageEvent): void {
    setTimeout(() => this.record(event), 0);
  }

  record(event: UsageEvent): void {
    if (!this.enabled) return;
    try {
      if (!this.ready) {
        this.buffer.push(event);
        return;
      }
      this.apply(event);
      this.persist();
      this.publish();
    } catch {
      this.error = "Usage totals could not be saved on this device.";
      this.publish();
    }
  }

  /** Clear Analytics. The epoch comes back from `clear_usage_analytics()`. */
  async clearAnalytics(): Promise<void> {
    const generation = this.generation + 1;
    this.generation = generation;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.inflight.clear();
    let epoch = this.epoch + 1;
    if (this.api) epoch = await this.api.clear();
    if (generation !== this.generation) return;
    this.epoch = epoch;
    this.days.clear();
    this.remote = [];
    this.buffer = [];
    this.legacy = null;
    this.storage.removeItem?.(LEGACY_KEY);
    this.storage.setItem(LEGACY_KEY, "");
    this.ready = true;
    this.persist();
    this.publish();
  }

  /** Test hook. Production flushes through the debounced queue. */
  flushNow(day?: string): Promise<void> {
    const days = day ? [day] : [...this.days.keys()];
    return Promise.all(days.map((key) => this.pump(key))).then(() => undefined);
  }

  private apply(event: UsageEvent): void {
    const stamp = this.now();
    const key = localDay(stamp);
    const existing = this.days.get(key);
    const counters = applyUsageEvent(existing?.counters ?? emptyCounters(), event, stamp.getHours());
    const day: UsageDay = {
      day: key,
      epoch: this.epoch,
      revision: (existing?.revision ?? 0) + 1,
      updatedAt: stamp.toISOString(),
      dirty: true,
      counters,
    };
    this.days.set(key, day);
    this.schedule(key);
  }

  private applyEpoch(epoch: number): void {
    this.generation += 1;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    if (epoch !== this.epoch) {
      this.epoch = epoch;
      this.buffer = [];
      for (const [key, day] of this.days) {
        if (day.epoch !== epoch) this.days.delete(key);
      }
    }
  }

  private schedule(day: string): void {
    if (!this.api || !this.deviceId) return;
    const timer = this.timers.get(day);
    if (timer) clearTimeout(timer);
    this.timers.set(day, setTimeout(() => {
      this.timers.delete(day);
      void this.pump(day);
    }, this.debounceMs));
  }

  private async pump(day: string): Promise<void> {
    if (!this.api || !this.deviceId) return;
    if (this.inflight.has(day)) return;
    const snapshot = this.days.get(day);
    if (!snapshot?.dirty || snapshot.epoch !== this.epoch) return;
    const generation = this.generation;
    const revision = snapshot.revision;
    this.inflight.add(day);
    try {
      await this.api.upsertDay({
        deviceId: this.deviceId,
        day: snapshot.day,
        epoch: snapshot.epoch,
        revision,
        updatedAt: snapshot.updatedAt,
        counters: snapshot.counters,
      });
      if (generation !== this.generation) return;
      const current = this.days.get(day);
      if (current && current.revision === revision) {
        current.dirty = false;
        this.prune();
        this.persist();
        this.publish();
      }
    } catch {
      if (generation === this.generation) {
        this.error = "Usage totals could not be saved on this device.";
        this.publish();
      }
    } finally {
      this.inflight.delete(day);
      const current = this.days.get(day);
      if (generation === this.generation && current?.dirty) void this.pump(day);
    }
  }

  private prune(): void {
    const clean = [...this.days.values()].filter((day) => !day.dirty).sort((a, b) => b.day.localeCompare(a.day));
    for (const day of clean.slice(CLEAN_DAY_KEEP)) this.days.delete(day.day);
  }

  private load(): void {
    this.legacy = readLegacy(this.storage);
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      const fields = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
      if (fields.version !== STORAGE_VERSION || !Array.isArray(fields.days)) return;
      this.epoch = typeof fields.epoch === "number" && fields.epoch >= 0 ? Math.floor(fields.epoch) : 0;
      for (const entry of fields.days) {
        const day = parseDay(entry);
        if (day && day.epoch === this.epoch) this.days.set(day.day, day);
      }
    } catch {
      this.days.clear();
      this.error = "Usage totals could not be loaded on this device.";
    }
  }

  private persist(): void {
    const file: StoredFile = {
      version: STORAGE_VERSION,
      epoch: this.epoch,
      days: [...this.days.values()],
    };
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(file));
      this.error = null;
    } catch {
      this.error = "Usage totals could not be saved on this device.";
    }
  }

  private buildSnapshot(): UsageSnapshot {
    return {
      platform: this.platform,
      epoch: this.epoch,
      days: [...this.days.values()].map((day) => ({ ...day, counters: cloneCounters(day.counters) })),
      remote: this.remote,
      legacy: this.legacy,
      error: this.error,
      ready: this.ready,
    };
  }

  private publish(): void {
    this.cached = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }
}

function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function remoteAsLocal(row: RemoteUsageDay): UsageDay {
  return {
    day: row.day,
    epoch: row.epoch,
    revision: row.revision,
    updatedAt: row.updatedAt,
    dirty: false,
    counters: parseCounters(row.counters),
  };
}

function parseDay(value: unknown): UsageDay | null {
  if (typeof value !== "object" || value === null) return null;
  const fields = value as Record<string, unknown>;
  if (typeof fields.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fields.day)) return null;
  return {
    day: fields.day,
    epoch: typeof fields.epoch === "number" && fields.epoch >= 0 ? Math.floor(fields.epoch) : 0,
    revision: typeof fields.revision === "number" && fields.revision >= 0 ? Math.floor(fields.revision) : 0,
    updatedAt: typeof fields.updatedAt === "string" ? fields.updatedAt : new Date(0).toISOString(),
    dirty: fields.dirty === true,
    counters: parseCounters(fields.counters),
  };
}

function readLegacy(storage: UsageStorage): LegacyUsage | null {
  try {
    const raw = storage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const fields = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
    if (fields.version !== 1) return null;
    const totals = typeof fields.totals === "object" && fields.totals !== null ? fields.totals as Record<string, unknown> : {};
    const completed = typeof totals.dictation_completed === "number" ? totals.dictation_completed : 0;
    const duration = typeof totals.durationMsTotal === "number" ? totals.durationMsTotal : 0;
    if (completed <= 0 && duration <= 0) return null;
    return { dictationCompleted: completed, durationMs: duration };
  } catch {
    return null;
  }
}

