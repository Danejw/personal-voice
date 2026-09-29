import { useEffect, useSyncExternalStore } from "react";
import type {
  DictationHistorySnapshot,
  DictationHistoryStore,
} from "@/history/DictationHistoryStore";

/** Subscribes the shared UI and refreshes when the window is shown again, like voice notes. */
export function useDictationHistory(store: DictationHistoryStore): DictationHistorySnapshot {
  useEffect(() => {
    const refresh = () => store.reload();
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
