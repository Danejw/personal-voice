import { useEffect, useSyncExternalStore } from "react";
import type { PersonalSyncStore, SyncSnapshot } from "@/sync/PersonalSyncStore";

/** Follows the signed-in account and re-renders on every sync change. */
export function usePersonalSync(store: PersonalSyncStore, userId: string | null): SyncSnapshot {
  useEffect(() => {
    void store.setUser(userId);
  }, [store, userId]);

  // Offline has no background polling: retry when the network returns or the window is looked at again.
  useEffect(() => {
    const retry = () => {
      if (store.getSnapshot().status === "offline") void store.reload();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") retry();
    };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [store]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
