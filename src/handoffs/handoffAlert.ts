import { handoffDisplayText } from "@/assistant/continuation";
import type { Handoff, OwnedDevice } from "@/handoffs/handoff";
import type { HandoffStatus } from "@/handoffs/HandoffStore";
import { clipOverlayText } from "@/overlay/overlay";

/** How often a signed-in device asks Supabase for new handoffs, even while Settings is hidden. */
export const HANDOFF_POLL_MS = 8000;

export interface HandoffAlert {
  id: string;
  title: string;
  body: string;
}

export interface ArrivalState {
  primed: boolean;
  seen: ReadonlySet<string>;
}

export interface ArrivalSnapshot {
  status: HandoffStatus;
  received: readonly Handoff[];
  devices: readonly OwnedDevice[];
}

export function initialArrivalState(): ArrivalState {
  return { primed: false, seen: new Set() };
}

/**
 * The first synced list is the backlog already on this device, so it does not alert.
 * Later ids alert once. A reload that is not synced leaves the seen set alone.
 */
export function nextArrivals(state: ArrivalState, snapshot: ArrivalSnapshot): { state: ArrivalState; alerts: HandoffAlert[] } {
  if (snapshot.status !== "synced") return { state, alerts: [] };
  const ids = snapshot.received.map((handoff) => handoff.id);
  if (!state.primed) {
    return { state: { primed: true, seen: new Set(ids) }, alerts: [] };
  }
  const alerts: HandoffAlert[] = [];
  const seen = new Set(state.seen);
  for (const handoff of snapshot.received) {
    if (seen.has(handoff.id)) continue;
    seen.add(handoff.id);
    alerts.push({
      id: handoff.id,
      title: sourceName(snapshot.devices, handoff.sourceDeviceId),
      body: clipOverlayText(handoffDisplayText(handoff.text)),
    });
  }
  return { state: { primed: true, seen }, alerts };
}

function sourceName(devices: readonly OwnedDevice[], sourceDeviceId: string): string {
  const name = devices.find((device) => device.id === sourceDeviceId)?.name?.trim();
  return name ? name : "Another device";
}
