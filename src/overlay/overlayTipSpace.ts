import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type OverlayTipSide = "left" | "right";

let tipSpaceOpen = false;
let tipSide: OverlayTipSide = "left";
let pending: Promise<OverlayTipSide> | null = null;

function parseSide(value: string): OverlayTipSide {
  return value === "right" ? "right" : "left";
}

/**
 * Grow the indicator window beside the buttons while a tray tip is showing.
 * Calls `onSide` before and after resize so dock alignment matches the side
 * that actually fits on the current monitor.
 */
export async function setOverlayTipSpace(
  open: boolean,
  onSide?: (side: OverlayTipSide) => void,
): Promise<OverlayTipSide> {
  if (getCurrentWindow().label !== "indicator") return tipSide;
  if (open === tipSpaceOpen) return tipSide;

  const run = async (): Promise<OverlayTipSide> => {
    if (open) {
      const peeked = parseSide(await invoke<string>("peek_overlay_tip_side"));
      tipSide = peeked;
      onSide?.(peeked);
      // Let React apply is-tip-right / flex alignment before the HWND grows.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      tipSpaceOpen = true;
      const side = parseSide(await invoke<string>("resize_overlay", { expanded: true, side: peeked }));
      tipSide = side;
      if (side !== peeked) onSide?.(side);
      return tipSide;
    }
    tipSpaceOpen = false;
    await invoke<string>("resize_overlay", { expanded: false, side: null });
    return tipSide;
  };

  const next = (pending ?? Promise.resolve(tipSide)).then(run, run);
  pending = next.then(
    (side) => { pending = null; return side; },
    () => { pending = null; return tipSide; },
  );
  return next;
}

/** Last side chosen for the overlay tip space. */
export function overlayTipSide(): OverlayTipSide {
  return tipSide;
}
