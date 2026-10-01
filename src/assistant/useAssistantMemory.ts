import { useEffect, useSyncExternalStore } from "react";
import type { AssistantMemoryStore, MemorySnapshot } from "@/assistant/AssistantMemoryStore";

/** Subscribes to explicit memories and re-reads them when the app is visible again. */
export function useAssistantMemory(store: AssistantMemoryStore): MemorySnapshot {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void store.refresh();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [store]);
  return snapshot;
}
