import { describe, expect, it } from "vitest";
import { viewSection, type MonitorRect } from "./layout";
import { PerspectiveCamera, Vector3 } from "three";

const monitor = (x: number, y: number, width: number, height: number, scale = 1): MonitorRect =>
  ({ x, y, width, height, scale });

describe("physical desktop view sections", () => {
  it("projects a world point into the same global pixel in adjacent camera slices", () => {
    const displays = [monitor(-1920, 0, 1920, 1080), monitor(0, 0, 2560, 1440, 1.5), monitor(2560, -200, 1440, 2560, 2)];
    const pixels = displays.map((_, i) => {
      const view = viewSection(displays, i);
      const camera = new PerspectiveCamera(52, 1, 0.1, 180);
      camera.setViewOffset(view.fullWidth, view.fullHeight, view.x, view.y, view.width, view.height);
      const point = new Vector3(2, 1, -20).project(camera);
      return { x: view.x + (point.x + 1) * view.width / 2, y: view.y + (1 - point.y) * view.height / 2 };
    });
    for (const point of pixels.slice(1)) {
      expect(point.x).toBeCloseTo(pixels[0]!.x, 8);
      expect(point.y).toBeCloseTo(pixels[0]!.y, 8);
    }
  });
  it("uses one full viewport across three displays with a negative origin and mixed DPI", () => {
    const displays = [monitor(-1920, 0, 1920, 1080), monitor(0, 0, 2560, 1440, 1.25), monitor(2560, 0, 3840, 2160, 1.5)];
    const sections = displays.map((_, i) => viewSection(displays, i));
    expect(sections.map(s => s.fullWidth)).toEqual([8320, 8320, 8320]);
    expect(sections.map(s => s.fullHeight)).toEqual([2160, 2160, 2160]);
    expect(sections.map(s => s.x)).toEqual([0, 1920, 4480]);
    expect(sections[0]!.x + sections[0]!.width).toBe(sections[1]!.x);
    expect(sections[1]!.x + sections[1]!.width).toBe(sections[2]!.x);
  });

  it("retains gaps, vertical offsets, and portrait display dimensions", () => {
    const displays = [monitor(-1200, -1920, 1080, 1920, 1.5), monitor(0, 0, 2560, 1440, 2)];
    expect(viewSection(displays, 1)).toEqual({ fullWidth: 3760, fullHeight: 3360, x: 1200, y: 1920, width: 2560, height: 1440 });
    expect(viewSection(displays, 0).width).toBe(1080);
  });

  it("does not apply monitor DPI to already physical coordinates", () => {
    const displays = [monitor(0, 0, 1920, 1080), monitor(1920, 0, 1920, 1080, 2)];
    expect(viewSection(displays, 1).x).toBe(1920);
    expect(viewSection(displays, 1).width).toBe(1920);
  });

  it("rejects unavailable displays and malformed dimensions before rendering", () => {
    expect(() => viewSection([], 0)).toThrow();
    expect(() => viewSection([monitor(0, 0, 0, 1080)], 0)).toThrow();
    expect(() => viewSection([monitor(NaN, 0, 1920, 1080)], 0)).toThrow();
    expect(() => viewSection([monitor(0, 0, 1920, 1080)], 1)).toThrow();
  });
});
