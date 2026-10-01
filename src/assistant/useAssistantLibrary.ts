import { useEffect, useSyncExternalStore } from "react";
import type { AssistantConversationStore, AssistantLibrarySnapshot } from "@/assistant/AssistantConversationStore";

/** Subscribes to the saved-conversation list and re-reads it when the app is visible again. */
export function useAssistantLibrary(store: AssistantConversationStore): AssistantLibrarySnapshot {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void store.catchUp();
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
