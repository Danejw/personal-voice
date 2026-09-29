import { useEffect, useSyncExternalStore } from "react";
import { HANDOFF_POLL_MS } from "@/handoffs/handoffAlert";
import type { HandoffSnapshot, HandoffStore } from "@/handoffs/HandoffStore";

/** Loads account devices and pending handoffs, refreshing when this device is revisited. */
export function useHandoffs(store: HandoffStore, userId: string | null): HandoffSnapshot {
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

  // Settings is often hidden in the tray, so focus alone cannot notice a handoff from the other computer.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (store.getSnapshot().status !== "signed-out") void store.reload();
    }, HANDOFF_POLL_MS);
    return () => window.clearInterval(timer);
  }, [store]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
