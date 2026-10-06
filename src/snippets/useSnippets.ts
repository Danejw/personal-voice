import { useEffect, useSyncExternalStore } from "react";
import type { SnippetSnapshot, SnippetStore } from "@/snippets/SnippetStore";

export function useSnippets(store: SnippetStore, userId: string | null): SnippetSnapshot {
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
