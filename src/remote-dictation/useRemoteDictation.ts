import { useEffect, useSyncExternalStore } from "react";
import type { RemoteDictationSnapshot, RemoteDictationStore } from "@/remote-dictation/RemoteDictationStore";

/** Subscribes to Remote Dictation target/receiver state. Loops start inside the store. */
export function useRemoteDictation(store: RemoteDictationStore, userId: string | null): RemoteDictationSnapshot {
  useEffect(() => {
    void store.setUser(userId);
  }, [store, userId]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
