import { useSyncExternalStore } from "react";
import type { UsageStore } from "@/usage/UsageStore";
import type { UsageSnapshot } from "@/usage/usageEvents";

/** Subscribes the Settings UI to this device's usage totals. */
export function useUsage(store: UsageStore): UsageSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
