import { useEffect, useSyncExternalStore } from "react";
import type { RemoteReadSnapshot, RemoteReadStore } from "@/assistant/RemoteReadStore";

const REMOTE_READ_POLL_MS = 4_000;

/** Refreshes presence and answers read requests aimed at this device. */
export function useRemoteReads(store: RemoteReadStore, userId: string | null): RemoteReadSnapshot {
  useEffect(() => {
    if (!userId) return;
    const tick = () => { void store.poll(userId); };
    tick();
    const timer = window.setInterval(tick, REMOTE_READ_POLL_MS);
    return () => window.clearInterval(timer);
  }, [store, userId]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
