import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

let confirmSpaceOpen = false;
let pending: Promise<void> | null = null;

/**
 * Grow the indicator window downward while Confirm and Cancel are showing.
 * Goes through the native pin path so a resize cannot snap the height back.
 */
export async function setOverlayConfirmSpace(open: boolean): Promise<void> {
  if (getCurrentWindow().label !== "indicator") return;
  if (open === confirmSpaceOpen) return;
  confirmSpaceOpen = open;

  const run = () => invoke<void>("resize_overlay_confirm", { expanded: open });
  const next = (pending ?? Promise.resolve()).then(run, run);
  pending = next.then(
    () => { pending = null; },
    () => { pending = null; },
  );
  await next;
}
