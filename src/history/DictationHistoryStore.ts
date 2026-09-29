import type {
  TranscriptDeliveryResult,
  TranscriptDestinationId,
} from "@/voice/transcript/TranscriptDestination";

export const DICTATION_HISTORY_LIMIT = 75;
const STORAGE_KEY = "dictation.history.v1";

type HistoryStorage = Pick<Storage, "getItem" | "setItem">;

export interface DictationHistoryEntry {
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
  return {
    text: entry.text,
    timestamp: entry.timestamp,
    destination: entry.destination,
    outcome: entry.outcome,
  };
}

/** Bounded local-only finalized dictation history. No audio or cloud writes are involved. */
export class DictationHistoryStore {
  private snapshot: DictationHistorySnapshot;
  private listeners = new Set<() => void>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly limit: number;

  constructor(
    private storage: HistoryStorage,
    limit = DICTATION_HISTORY_LIMIT,
    private now: () => Date = () => new Date(),
  ) {
    this.limit = Math.max(1, Math.floor(limit));
    this.snapshot = this.load();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DictationHistorySnapshot => this.snapshot;

  /**
   * Shows the entry immediately, then writes storage after delivery returns.
   * Storage failures stay inside the deferred write and cannot change the destination outcome.
   */
  recordLater(result: TranscriptDeliveryResult): void {
    this.prepend(result);
    this.schedulePersist();
  }

  /** Picks up an entry written while this view was in the background. */
  reload(): void {
    const stored = this.load();
    const currentHead = this.snapshot.entries[0]?.timestamp ?? "";
    const storedHead = stored.entries[0]?.timestamp ?? "";
    if (storedHead < currentHead) return;
    const sameList = storedHead === currentHead && stored.entries.length === this.snapshot.entries.length;
    if (sameList && stored.error === this.snapshot.error) return;
    this.snapshot = stored;
    this.emit();
  }

  record(result: TranscriptDeliveryResult): void {
    this.prepend(result);
    this.flush();
  }

  clear(): void {
    this.cancelPersist();
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

  private prepend(result: TranscriptDeliveryResult): void {
    const entry: DictationHistoryEntry = {
      ...result,
      timestamp: this.now().toISOString(),
    };
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
    if (error === this.snapshot.error) return;
    this.snapshot = { entries: this.snapshot.entries, error };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
