import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

let tipSpaceOpen = false;
let pending: Promise<void> | null = null;

/**
 * Grow the indicator window leftward while a tray tip is showing.
 * Goes through the native pin path so a resize event cannot snap it back to 44px.
 */
export async function setOverlayTipSpace(open: boolean): Promise<void> {
  if (getCurrentWindow().label !== "indicator") return;
  if (open === tipSpaceOpen) return;
  tipSpaceOpen = open;

  const run = () => invoke<void>("resize_overlay", { expanded: open });
  const next = (pending ?? Promise.resolve()).then(run, run);
  pending = next.then(
    () => { pending = null; },
    () => { pending = null; },
  );
  await next;
}
