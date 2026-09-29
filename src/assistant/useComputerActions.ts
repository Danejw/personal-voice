import { useEffect, useSyncExternalStore } from "react";
import type { ComputerActionSnapshot, ComputerActionStore } from "@/assistant/ComputerActionStore";

const COMPUTER_ACTION_POLL_MS = 4_000;

/** Answers allowlisted action requests aimed at this device. */
export function useComputerActions(store: ComputerActionStore, userId: string | null): ComputerActionSnapshot {
  useEffect(() => {
    if (!userId) return;
    const tick = () => { void store.poll(userId); };
    tick();
    const timer = window.setInterval(tick, COMPUTER_ACTION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [store, userId]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
