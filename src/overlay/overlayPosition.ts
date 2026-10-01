import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const ANCHOR_KEY = "settings.overlayAnchor";
/** Client pixels before a press on the logo becomes a tray drag. */
export const OVERLAY_DRAG_SLOP = 8;

export interface OverlayAnchor {
  x: number;
  y: number;
}

function isIndicator(): boolean {
  try {
    return getCurrentWindow().label === "indicator";
  } catch {
    return false;
  }
}

function isAnchor(value: unknown): value is OverlayAnchor {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.x === "number" && Number.isFinite(record.x)
    && typeof record.y === "number" && Number.isFinite(record.y);
}

/** Reads a saved bottom-right anchor from install-local storage. */
export function loadOverlayAnchor(storage: Pick<Storage, "getItem"> = localStorage): OverlayAnchor | null {
  const raw = storage.getItem(ANCHOR_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isAnchor(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Persists the overlay's bottom-right anchor on this install only. */
export function saveOverlayAnchor(
  anchor: OverlayAnchor,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(ANCHOR_KEY, JSON.stringify({ x: Math.round(anchor.x), y: Math.round(anchor.y) }));
}

/** Applies a saved (or cleared) anchor and re-pins the indicator window. */
export async function applyOverlayAnchor(anchor: OverlayAnchor | null): Promise<void> {
  if (!isIndicator()) return;
  await invoke<void>("set_overlay_anchor", {
    x: anchor?.x ?? null,
    y: anchor?.y ?? null,
  });
}

/** Tells Rust to stop re-pinning while the tray is being moved. */
export async function beginOverlayDrag(): Promise<void> {
  if (!isIndicator()) return;
  await invoke<void>("begin_overlay_drag");
}

/**
 * Hand the drag to the OS. Uses the already-allowed start-dragging permission
 * and avoids WebView pointer-capture issues while the HWND moves.
 */
export async function startOverlayWindowDrag(): Promise<void> {
  if (!isIndicator()) return;
  await beginOverlayDrag();
  await getCurrentWindow().startDragging();
}

/** Moves the indicator to a physical top-left while dragging (manual fallback). */
export async function dragOverlayTo(x: number, y: number): Promise<void> {
  if (!isIndicator()) return;
  await invoke<void>("drag_overlay", { x: Math.round(x), y: Math.round(y) });
}

/** Commits the current window rect as the custom anchor and returns it. */
export async function commitOverlayPosition(): Promise<OverlayAnchor | null> {
  if (!isIndicator()) return null;
  const [x, y] = await invoke<[number, number]>("commit_overlay_position");
  const anchor = { x, y };
  saveOverlayAnchor(anchor);
  return anchor;
}

/** Restores a previously saved tray position into the native pin path. */
export async function restoreOverlayPosition(
  storage: Pick<Storage, "getItem"> = localStorage,
): Promise<void> {
  const anchor = loadOverlayAnchor(storage);
  if (!anchor) return;
  await applyOverlayAnchor(anchor);
}
