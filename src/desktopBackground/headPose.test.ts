import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { applyHeadView, CENTER, relativePose } from "./headPose";
import { viewSection } from "./layout";

describe("calibrated head movement", () => {
  const neutral = { x: 0.5, y: 0.4, span: 0.2 };
  it("centers at calibration, follows translation, and allows horizontal reversal", () => {
    expect(relativePose(neutral, neutral, 1, false)).toEqual(CENTER);
    expect(relativePose({ ...neutral, x: 0.6 }, neutral, 1, false).x).toBeCloseTo(-0.5);
    expect(relativePose({ ...neutral, x: 0.6 }, neutral, 1, true).x).toBeCloseTo(0.5);
    expect(relativePose({ ...neutral, y: 0.3 }, neutral, 1, false).y).toBeCloseTo(0.5);
    expect(relativePose({ ...neutral, span: 0.1 }, neutral, 1, false).z).toBeCloseTo(0.5);
  });
  it("bounds motion and rejects invalid tracking samples", () => {
    expect(relativePose({ x: 40, y: -40, span: 0.001 }, neutral, 2, false)).toEqual({ x: -1, y: 1, z: 1 });
    expect(relativePose({ ...neutral, span: 0 }, neutral, 1, false)).toEqual(CENTER);
    expect(relativePose({ ...neutral, x: NaN }, neutral, 1, false)).toEqual(CENTER);
    expect(relativePose({ ...neutral, x: 0.8 }, neutral, 0, false).x).toBe(0);
  });
});

describe("head-coupled monitor projection", () => {
  const displays = [
    { x: -2560, y: 159, width: 2560, height: 1440, scale: 1 },
    { x: 0, y: 0, width: 2560, height: 1440, scale: 1.5 },
    { x: 2560, y: 264, width: 1920, height: 1080, scale: 1 },
  ];
  it("keeps a world point at one global pixel across every monitor for a moving eye", () => {
    for (const pose of [CENTER, { x: 0.5, y: -0.3, z: 0.2 }]) {
      const points = displays.map((_, index) => {
        const view = viewSection(displays, index);
        const camera = new PerspectiveCamera(52, 1, 0.1, 180);
        applyHeadView(camera, view, pose);
        const projected = new Vector3(2, 0, -20).project(camera);
        return { x: view.x + (projected.x + 1) * view.width / 2, y: view.y + (1 - projected.y) * view.height / 2 };
      });
      for (const point of points.slice(1)) {
        expect(point.x).toBeCloseTo(points[0]!.x, 6);
        expect(point.y).toBeCloseTo(points[0]!.y, 6);
      }
    }
  });
  it("changes perspective for a translation while a point on the screen plane stays anchored", () => {
    const view = viewSection(displays, 1);
    const camera = new PerspectiveCamera();
    applyHeadView(camera, view, CENTER);
    const before = new Vector3(0, 0, -30).project(camera).x;
    const reference = new PerspectiveCamera();
    reference.position.set(0, 8, 24);
    reference.lookAt(0, 0, -30);
    const screenPoint = new Vector3(0, 0, -24).applyQuaternion(reference.quaternion).add(reference.position);
    const screenBefore = screenPoint.clone().project(camera);
    applyHeadView(camera, view, { x: 0.7, y: 0, z: 0 });
    const after = new Vector3(0, 0, -30).project(camera).x;
    const screenAfter = screenPoint.clone().project(camera);
    expect(screenAfter.x).toBeCloseTo(screenBefore.x, 8);
    expect(screenAfter.y).toBeCloseTo(screenBefore.y, 8);
    expect(Math.abs(after - before)).toBeGreaterThan(0.001);
    expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
  });
});
