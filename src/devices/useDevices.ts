import { useEffect, useSyncExternalStore } from "react";
import type { DeviceSnapshot, DeviceStore } from "@/devices/DeviceStore";

/** Loads owned devices, refreshing when this device is revisited. */
export function useDevices(store: DeviceStore, userId: string | null): DeviceSnapshot {
  useEffect(() => {
    void store.setUser(userId);
  }, [store, userId]);

  useEffect(() => {
    const refresh = () => {
      if (store.getSnapshot().status !== "signed-out") void store.reload();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) refresh();
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

  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
