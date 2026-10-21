import { useEffect, useSyncExternalStore } from "react";
import type { ClipboardSnapshot, ClipboardStore } from "@/clipboard/ClipboardStore";
import type { PlatformAdapter } from "@/platform/PlatformAdapter";

/**
 * Binds clipboard history to the signed-in account and, on Windows, to the
 * clipboard change listener. Capture and sync are always on.
 */
export function useClipboardHistory(
  store: ClipboardStore,
  userId: string | null,
  deviceId: string | null,
  platform: PlatformAdapter,
): ClipboardSnapshot {
  useEffect(() => {
    store.setDevice(deviceId);
    store.loadPreferences();
  }, [store, deviceId]);

  useEffect(() => {
    void store.setUser(userId);
  }, [store, userId]);

  useEffect(() => {
    const refresh = () => {
      void store.reload();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [store]);

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  useEffect(() => {
    if (platform.platform !== "windows") return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    void platform.watchClipboard({ images: true }, (change) => {
      void store.ingest(change);
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else stop = unlisten;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [platform, store]);

  return snapshot;
}
