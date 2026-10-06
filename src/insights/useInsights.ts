import { useEffect, useSyncExternalStore } from "react";
import type { InsightsSnapshot, InsightsStore } from "@/insights/InsightsStore";

export function useInsights(store: InsightsStore, userId: string | null, active: boolean): InsightsSnapshot {
  useEffect(() => {
    void store.setUser(userId);
  }, [store, userId]);

  useEffect(() => {
    if (!active) return;
    const refresh = () => {
      if (store.getSnapshot().status !== "signed-out" && store.getSnapshot().status !== "analyzing") void store.reload();
    };
    const visible = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) refresh();
    };
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [store, active]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
