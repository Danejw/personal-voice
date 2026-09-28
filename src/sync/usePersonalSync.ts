import { useEffect, useSyncExternalStore } from "react";
import type { PersonalSyncStore, SyncSnapshot } from "@/sync/PersonalSyncStore";

/** Follows the signed-in account and re-renders on every sync change. */
export function usePersonalSync(store: PersonalSyncStore, userId: string | null): SyncSnapshot {
  useEffect(() => {
    void store.setUser(userId);
  }, [store, userId]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
