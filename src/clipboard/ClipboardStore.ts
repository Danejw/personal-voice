import {
  clipboardContentHash,
  clipboardIngestPlan,
  clipboardLooksSensitive,
  clipboardOverflowIds,
  classifyClipboardText,
  collapseClipboardHashes,
  decodeBase64,
  DEFAULT_CLIPBOARD_PREFERENCES,
  encodeBase64,
  MAX_CLIPBOARD_ENTRIES,
  normalizeClipboardSource,
  pruneClipboardTombstones,
  rankClipboardEntries,
  reconcileClipboard,
  type ClipboardChange,
  type ClipboardEntry,
  type ClipboardPreferences,
} from "@/clipboard/clipboardEntry";
import { readClipboardCache, writeClipboardCache } from "@/clipboard/clipboardCache";
import {
  bmpToPng,
  detectClipboardImageFormat,
  MAX_CLIPBOARD_BMP_TRANSPORT_BYTES,
  MAX_CLIPBOARD_IMAGE_BYTES,
} from "@/clipboard/clipboardImageCodec";
import type { ClipboardImageStore } from "@/clipboard/clipboardImages";
import { ClipboardHashConflict, type ClipboardApi } from "@/services/clipboardService";
import { createId } from "@/sync/createId";
import type { KeyValueStorage } from "@/sync/personalCache";

export type ClipboardStatus = "local" | "syncing" | "synced" | "offline";

export interface ClipboardSnapshot {
  status: ClipboardStatus;
  entries: ClipboardEntry[];
  preferences: ClipboardPreferences;
  error: string | null;
}

export interface ClipboardPreferenceAccess {
  load(): ClipboardPreferences;
  save(patch: Partial<ClipboardPreferences>): ClipboardPreferences;
}

export type ClipboardIngestResult = "saved" | "skipped" | "ignored";

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Clipboard sync failed.";
}

/**
 * Local-first clipboard history with account sync always on for a signed in user.
 * Sync never writes another device's clipboard. The caller copies an entry explicitly.
 */
export class ClipboardStore {
  private entries: ClipboardEntry[] = [];
  private clearedAt: string | null = null;
  private pendingClear = false;
  private userId: string | null = null;
  private deviceId: string | null = null;
  private preferences: ClipboardPreferences = { ...DEFAULT_CLIPBOARD_PREFERENCES };
  private syncState: "synced" | "offline" | "syncing" = "synced";
  private error: string | null = null;
  private generation = 0;
  private listeners = new Set<() => void>();
  private snapshot: ClipboardSnapshot = {
    status: "local",
    entries: [],
    preferences: { ...DEFAULT_CLIPBOARD_PREFERENCES },
    error: null,
  };

  constructor(
    private api: ClipboardApi,
    private storage: KeyValueStorage,
    private images: ClipboardImageStore,
    private preferenceAccess: ClipboardPreferenceAccess,
    private ids: () => string = createId,
    private now: () => string = () => new Date().toISOString(),
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ClipboardSnapshot => this.snapshot;

  /** Reloads the fixed clipboard behavior for this device. */
  loadPreferences(): void {
    this.preferences = this.preferenceAccess.load();
    this.publish();
  }

  setDevice(deviceId: string | null): void {
    this.deviceId = deviceId;
  }

  async setPreferences(patch: Partial<ClipboardPreferences>): Promise<void> {
    const next = this.preferenceAccess.save(patch);
    const turnedSyncOn = next.syncEnabled && !this.preferences.syncEnabled;
    this.preferences = next;
    if (turnedSyncOn) this.promoteLocalEntries();
    this.publish();
    if (next.syncEnabled) await this.flush();
  }

  async setUser(userId: string | null): Promise<void> {
    if (userId === this.userId && this.snapshot.entries.length) return;
    this.userId = userId;
    this.generation += 1;
    this.preferences = this.preferenceAccess.load();
    if (!userId) {
      const cached = readClipboardCache(this.storage, null);
      this.replace(cached.entries, cached.clearedAt, cached.pendingClear, "synced", null);
      await this.trimLocalOverflow();
      return;
    }
    const cached = readClipboardCache(this.storage, userId);
    const device = readClipboardCache(this.storage, null);
    const merged = this.mergeDeviceEntries(cached.entries, device.entries);
    writeClipboardCache(this.storage, null, { entries: [], clearedAt: null, pendingClear: false });
    this.replace(merged, cached.clearedAt, cached.pendingClear, "syncing", null);
    if (this.preferences.syncEnabled) await this.flush();
    else {
      await this.trimLocalOverflow();
      this.replace(this.entries, this.clearedAt, this.pendingClear, "synced", null);
    }
  }

  async reload(): Promise<void> {
    if (!this.userId || !this.preferences.syncEnabled) return;
    await this.flush();
  }

  /** Saves a supported clipboard change. Windows private copies carry no content and are skipped. */
  async ingest(change: ClipboardChange): Promise<ClipboardIngestResult> {
    if (!this.preferences.captureEnabled || this.preferences.paused) return "ignored";
    if (change.excluded || clipboardLooksSensitive({
      text: change.text,
      sourceApp: change.sourceApp,
      sourceProcess: change.sourceProcess,
      excludedByOs: change.excluded,
    })) return "ignored";

    const sourceApp = normalizeClipboardSource(change.sourceApp);
    const sourceProcess = normalizeClipboardSource(change.sourceProcess);
    const text = change.text ? classifyClipboardText(change.text) : null;
    if (text?.ok) {
      const hash = await clipboardContentHash(text.kind, text.text);
      return this.remember({
        kind: text.kind,
        text: text.text,
        hash,
        sourceApp,
        sourceProcess,
        image: null,
      });
    }
    if (!this.preferences.imagesEnabled || !change.imageBase64) return "ignored";
    const decoded = decodeBase64(change.imageBase64);
    if (!decoded) return "ignored";
    const format = detectClipboardImageFormat(decoded);
    if (!format || format !== change.imageFormat) return "ignored";
    const transportLimit = format === "bmp" ? MAX_CLIPBOARD_BMP_TRANSPORT_BYTES : MAX_CLIPBOARD_IMAGE_BYTES;
    if (decoded.length > transportLimit) return "ignored";
    // A raw BMP is only transport from the native sampler. Store and sync the PNG.
    const bytes = format === "bmp" ? await bmpToPng(decoded) : decoded;
    if (!detectClipboardImageFormat(bytes) || bytes.length > MAX_CLIPBOARD_IMAGE_BYTES) return "ignored";
    const hash = await clipboardContentHash("image", encodeBase64(bytes));
    return this.remember({
      kind: "image",
      text: null,
      hash,
      sourceApp,
      sourceProcess,
      image: bytes,
    });
  }

  /**
   * Records a selection that was copied onto the clipboard.
   * The OS clipboard write is the caller's job.
   */
  recordCapturedSelection(text: string, sourceApp?: string): Promise<ClipboardIngestResult> {
    return this.ingest({
      text,
      sourceApp: sourceApp ?? null,
      sourceProcess: null,
      excluded: false,
      imageBase64: null,
      imageFormat: null,
    });
  }

  /** Bumps reuse count and returns the entry to place on this device's clipboard. */
  async markCopied(id: string): Promise<ClipboardEntry | null> {
    const entry = this.entries.find((item) => item.id === id && item.deletedAt === null);
    if (!entry) return null;
    const now = this.now();
    const next: ClipboardEntry = {
      ...entry,
      copyCount: entry.copyCount + 1,
      lastCopiedAt: now,
      updatedAt: now,
      pending: this.accountPending(entry),
      visibility: this.preferences.syncEnabled && this.userId ? "account" : entry.visibility,
    };
    this.entries = this.entries.map((item) => item.id === id ? next : item);
    this.persist();
    if (next.pending === "upsert") await this.flush();
    return next;
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    const now = this.now();
    this.entries = this.entries.map((entry) => entry.id === id && entry.deletedAt === null
      ? {
        ...entry,
        pinned,
        updatedAt: now,
        pending: this.accountPending(entry),
        visibility: this.preferences.syncEnabled && this.userId ? "account" : entry.visibility,
      }
      : entry);
    this.persist();
    await this.flush();
  }

  async remove(id: string): Promise<void> {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) return;
    const now = this.now();
    if (entry.visibility === "local" && entry.pending !== "upsert") {
      this.entries = this.entries.filter((item) => item.id !== id);
      await this.images.delete(id);
    } else {
      this.entries = this.entries.map((item) => item.id === id ? this.tombstone(item, now) : item);
      await this.images.delete(id);
    }
    this.persist();
    await this.flush();
  }

  /** Deletes saved history on this device and, when sync is on, on the account. */
  async clear(): Promise<void> {
    const now = this.now();
    this.entries = [];
    this.clearedAt = now;
    this.pendingClear = Boolean(this.userId && this.preferences.syncEnabled);
    await this.images.clear();
    this.persist();
    await this.flush();
  }

  readImage(id: string): Promise<Uint8Array | null> {
    return this.images.get(id);
  }

  private async remember(input: {
    kind: ClipboardEntry["kind"];
    text: string | null;
    hash: string;
    sourceApp: string | null;
    sourceProcess: string | null;
    image: Uint8Array | null;
  }): Promise<ClipboardIngestResult> {
    const plan = clipboardIngestPlan(this.entries, input.hash);
    if (plan === "skip") return "skipped";
    const now = this.now();
    if (plan === "bump") {
      const current = rankClipboardEntries(this.entries).find((entry) => entry.contentHash === input.hash);
      if (!current) return "skipped";
      this.entries = this.entries.map((entry) => entry.id === current.id ? {
        ...entry,
        copyCount: entry.copyCount + 1,
        lastCopiedAt: now,
        updatedAt: now,
        sourceApp: input.sourceApp ?? entry.sourceApp,
        sourceProcess: input.sourceProcess ?? entry.sourceProcess,
        sourceDeviceId: this.deviceId ?? entry.sourceDeviceId,
        pending: this.accountPending(entry),
        visibility: this.preferences.syncEnabled && this.userId ? "account" : entry.visibility,
      } : entry);
    } else {
      const id = this.ids();
      if (input.image) await this.images.put(id, input.image);
      const account = Boolean(this.preferences.syncEnabled && this.userId);
      this.entries = [{
        id,
        kind: input.kind,
        text: input.text,
        contentHash: input.hash,
        sourceApp: input.sourceApp,
        sourceProcess: input.sourceProcess,
        sourceDeviceId: this.deviceId,
        pinned: false,
        copyCount: 1,
        lastCopiedAt: now,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        imagePath: null,
        visibility: account ? "account" : "local",
        pending: account ? "upsert" : "none",
      }, ...this.entries];
    }
    const overflow = this.applyOverflow(now);
    for (const id of overflow) await this.images.delete(id);
    this.persist();
    if (this.preferences.syncEnabled && this.userId) await this.flush();
    return "saved";
  }

  private applyOverflow(now: string): string[] {
    const overflow = new Set(clipboardOverflowIds(this.entries, MAX_CLIPBOARD_ENTRIES));
    if (!overflow.size) return [];
    this.entries = this.entries.flatMap((entry) => {
      if (!overflow.has(entry.id)) return [entry];
      if (entry.visibility === "local" && entry.pending === "none") return [];
      return [this.tombstone(entry, now)];
    });
    return [...overflow];
  }

  private async trimLocalOverflow(): Promise<void> {
    const overflow = this.applyOverflow(this.now());
    if (!overflow.length) return;
    for (const id of overflow) await this.images.delete(id);
    this.persist();
  }

  private tombstone(entry: ClipboardEntry, now: string): ClipboardEntry {
    return {
      ...entry,
      text: null,
      imagePath: entry.imagePath,
      deletedAt: now,
      updatedAt: now,
      pending: entry.visibility === "account" || entry.pending === "upsert" ? "delete" : "none",
      visibility: entry.visibility,
    };
  }

  private accountPending(entry: ClipboardEntry): ClipboardEntry["pending"] {
    return this.preferences.syncEnabled && this.userId ? "upsert" : entry.pending === "delete" ? "delete" : "none";
  }

  private promoteLocalEntries(): void {
    if (!this.userId) return;
    const now = this.now();
    this.entries = this.entries.map((entry) => entry.deletedAt === null && entry.visibility === "local"
      ? { ...entry, visibility: "account", pending: "upsert", updatedAt: now }
      : entry);
  }

  private mergeDeviceEntries(account: ClipboardEntry[], device: readonly ClipboardEntry[]): ClipboardEntry[] {
    const hashes = new Set(account.filter((entry) => entry.deletedAt === null).map((entry) => entry.contentHash));
    const extras = device.filter((entry) => entry.deletedAt === null && !hashes.has(entry.contentHash)).map((entry) => ({
      ...entry,
      sourceDeviceId: entry.sourceDeviceId ?? this.deviceId,
      visibility: this.preferences.syncEnabled ? "account" as const : "local" as const,
      pending: this.preferences.syncEnabled ? "upsert" as const : "none" as const,
    }));
    return [...extras, ...account];
  }

  private async flush(): Promise<void> {
    const userId = this.userId;
    if (!userId || !this.preferences.syncEnabled) return;
    const generation = this.generation;
    this.syncState = "syncing";
    this.publish();
    try {
      if (this.pendingClear && this.clearedAt) {
        await this.api.clear(userId, this.clearedAt);
        if (generation !== this.generation) return;
        this.pendingClear = false;
      }
      for (const entry of [...this.entries]) {
        if (generation !== this.generation) return;
        if (entry.pending === "none" || entry.visibility !== "account") continue;
        if (entry.pending === "delete") {
          await this.api.remove(userId, entry);
          this.entries = this.entries.map((item) => item.id === entry.id ? { ...item, pending: "none", imagePath: null } : item);
          continue;
        }
        let imagePath = entry.imagePath;
        if (entry.kind === "image" && !imagePath && entry.deletedAt === null) {
          const bytes = await this.images.get(entry.id);
          if (bytes) imagePath = await this.api.uploadImage(userId, entry.id, bytes);
        }
        try {
          await this.api.upsert(userId, { ...entry, imagePath });
        } catch (reason) {
          if (!(reason instanceof ClipboardHashConflict)) throw reason;
        }
        this.entries = this.entries.map((item) => item.id === entry.id ? { ...item, imagePath, pending: "none", visibility: "account" } : item);
      }
      const remote = await this.api.list(userId);
      if (generation !== this.generation) return;
      const clearedAt = remote.clearedAt && (!this.clearedAt || remote.clearedAt > this.clearedAt)
        ? remote.clearedAt
        : this.clearedAt;
      const previous = this.entries;
      const merged = pruneClipboardTombstones(
        collapseClipboardHashes(reconcileClipboard(this.entries, remote.entries, clearedAt)),
        Date.parse(this.now()),
      );
      this.entries = merged;
      this.clearedAt = clearedAt;
      this.applyOverflow(this.now());
      for (const entry of [...this.entries]) {
        if (generation !== this.generation) return;
        if (entry.pending !== "delete" || entry.visibility !== "account") continue;
        await this.api.remove(userId, entry);
        this.entries = this.entries.map((item) => item.id === entry.id ? { ...item, pending: "none", imagePath: null } : item);
      }
      await this.forgetImages(previous, this.entries);
      await this.cacheRemoteImages(merged);
      this.syncState = "synced";
      this.error = null;
      this.persist();
    } catch (reason) {
      if (generation !== this.generation) return;
      this.syncState = "offline";
      this.error = messageOf(reason);
      this.persist();
    }
  }

  private async cacheRemoteImages(entries: readonly ClipboardEntry[]): Promise<void> {
    if (!this.preferences.imagesEnabled) return;
    for (const entry of entries) {
      if (entry.kind !== "image" || !entry.imagePath || entry.deletedAt) continue;
      const existing = await this.images.get(entry.id);
      if (existing) continue;
      try {
        const bytes = await this.api.downloadImage(entry.imagePath);
        await this.images.put(entry.id, bytes);
      } catch {
        // The row is still listed. The thumbnail can load on the next sync.
      }
    }
  }

  private async forgetImages(previous: readonly ClipboardEntry[], next: readonly ClipboardEntry[]): Promise<void> {
    const kept = new Set(next.filter((entry) => entry.deletedAt === null).map((entry) => entry.id));
    for (const entry of previous) {
      if (entry.kind === "image" && !kept.has(entry.id)) await this.images.delete(entry.id);
    }
  }

  private replace(
    entries: ClipboardEntry[],
    clearedAt: string | null,
    pendingClear: boolean,
    syncState: "synced" | "offline" | "syncing",
    error: string | null,
  ): void {
    this.entries = entries;
    this.clearedAt = clearedAt;
    this.pendingClear = pendingClear;
    this.syncState = syncState;
    this.error = error;
    this.persist();
  }

  private persist(): void {
    writeClipboardCache(this.storage, this.userId, {
      entries: this.entries,
      clearedAt: this.clearedAt,
      pendingClear: this.pendingClear,
    });
    this.publish();
  }

  private publish(): void {
    const syncing = Boolean(this.userId && this.preferences.syncEnabled);
    this.snapshot = {
      status: !syncing ? "local" : this.syncState === "syncing" ? "syncing" : this.syncState,
      entries: rankClipboardEntries(this.entries),
      preferences: this.preferences,
      error: this.error,
    };
    for (const listener of this.listeners) listener();
  }
}
