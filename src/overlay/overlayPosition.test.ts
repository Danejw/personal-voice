import { describe, expect, it } from "vitest";
import {
  loadOverlayAnchor,
  OVERLAY_DRAG_SLOP,
  saveOverlayAnchor,
} from "@/overlay/overlayPosition";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    clear() { map.clear(); },
    getItem(key) { return map.has(key) ? map.get(key)! : null; },
    key(index) { return [...map.keys()][index] ?? null; },
    removeItem(key) { map.delete(key); },
    setItem(key, value) { map.set(key, String(value)); },
  };
}

describe("overlayPosition", () => {
  it("exports the drag slop used by the logo button", () => {
    expect(OVERLAY_DRAG_SLOP).toBe(8);
  });

  it("round-trips a bottom-right anchor in install-local storage", () => {
    const storage = memoryStorage();
    saveOverlayAnchor({ x: 1800.6, y: 900.2 }, storage);
    expect(loadOverlayAnchor(storage)).toEqual({ x: 1801, y: 900 });
  });

  it("ignores missing or corrupt anchors", () => {
    expect(loadOverlayAnchor(memoryStorage())).toBeNull();
    expect(loadOverlayAnchor(memoryStorage({ "settings.overlayAnchor": "nope" }))).toBeNull();
    expect(loadOverlayAnchor(memoryStorage({ "settings.overlayAnchor": "{\"x\":1}" }))).toBeNull();
  });
});
