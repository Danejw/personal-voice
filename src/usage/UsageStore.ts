import type { PlatformName } from "@/platform/PlatformAdapter";
import {
  EMPTY_USAGE_TOTALS,
  applyUsageEvent,
} from "@/usage/usageEvents";
import type { UsageEvent, UsageSnapshot, UsageTotals } from "@/usage/usageEvents";

const STORAGE_KEY = "usage.totals.v1";
const STORAGE_VERSION = 1;

type UsageStorage = Pick<Storage, "getItem" | "setItem">;

function isDestinationCount(value: unknown): value is UsageTotals["destination_used"] {
  if (typeof value !== "object" || value === null) return false;
  const counts = value as Record<string, unknown>;
  return (
    Number.isFinite(counts["active-field"])
    && Number.isFinite(counts["voice-note"])
    && Number.isFinite(counts["send-to-device"])
  );
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function parseTotals(value: unknown): UsageTotals {
  const fields = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const destinations = isDestinationCount(fields.destination_used)
    ? {
      "active-field": count(fields.destination_used["active-field"]),
      "voice-note": count(fields.destination_used["voice-note"]),
      "send-to-device": count(fields.destination_used["send-to-device"]),
    }
    : { ...EMPTY_USAGE_TOTALS.destination_used };
  return {
    dictation_started: count(fields.dictation_started),
    dictation_completed: count(fields.dictation_completed),
    dictation_failed: count(fields.dictation_failed),
    recovery_used: count(fields.recovery_used),
    destination_used: destinations,
    voice_note_created: count(fields.voice_note_created),
    handoff_created: count(fields.handoff_created),
    selection_captured: count(fields.selection_captured),
    durationMsTotal: count(fields.durationMsTotal),
  };
}

/** Local counters only. Persistence failures never throw to the caller. */
export class UsageStore {
  private snapshot: UsageSnapshot;
  private listeners = new Set<() => void>();
  private enabled = true;

  constructor(
    private storage: UsageStorage,
    platform: PlatformName,
  ) {
    this.snapshot = this.load(platform);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): UsageSnapshot => this.snapshot;

  /** Account setting. Off means new events are dropped; existing totals stay. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Schedules a record after the current turn so dictation never awaits telemetry. */
  recordLater(event: UsageEvent): void {
    setTimeout(() => this.record(event), 0);
  }

  record(event: UsageEvent): void {
    if (!this.enabled) return;
    try {
      this.save(applyUsageEvent(this.snapshot.totals, event));
    } catch {
      // Telemetry must never break dictation or capture.
    }
  }

  private load(platform: PlatformName): UsageSnapshot {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return { platform, totals: { ...EMPTY_USAGE_TOTALS, destination_used: { ...EMPTY_USAGE_TOTALS.destination_used } }, error: null };
      const parsed: unknown = JSON.parse(raw);
      const fields = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
      if (fields.version !== STORAGE_VERSION) {
        return { platform, totals: cloneEmpty(), error: null };
      }
      return { platform, totals: parseTotals(fields.totals), error: null };
    } catch {
      return { platform, totals: cloneEmpty(), error: "Usage totals could not be loaded on this device." };
    }
  }

  private save(totals: UsageTotals): void {
    let error: string | null = null;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify({
        version: STORAGE_VERSION,
        platform: this.snapshot.platform,
        totals,
      }));
    } catch {
      error = "Usage totals could not be saved on this device.";
    }
    this.snapshot = { ...this.snapshot, totals, error };
    for (const listener of this.listeners) listener();
  }
}

function cloneEmpty(): UsageTotals {
  return { ...EMPTY_USAGE_TOTALS, destination_used: { ...EMPTY_USAGE_TOTALS.destination_used } };
}
