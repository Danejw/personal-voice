import { describe, expect, it } from "vitest";
import {
  assertCameraJpeg,
  cameraFacingFromArgs,
  cameraFacingLabel,
  cameraFrameIntervalMs,
  clampCameraFps,
  fitCameraEdge,
  inferFacingFromLabel,
  LatestFrameGate,
  parseCameraFacing,
  resolveCameraDevice,
  validateCameraFrame,
} from "@/platform/camera/cameraLogic";
import type { CameraDevice, CameraFrame } from "@/platform/camera/types";

/** Minimal valid JPEG (SOI + marker). */
const TINY_JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xd9));

function frame(overrides: Partial<CameraFrame> = {}): CameraFrame {
  return {
    jpeg: TINY_JPEG,
    width: 640,
    height: 480,
    capturedAt: "2026-10-03T20:00:00.000Z",
    facing: "default",
    ...overrides,
  };
}

describe("parseCameraFacing", () => {
  it("accepts default, front, and back", () => {
    expect(parseCameraFacing("default")).toBe("default");
    expect(parseCameraFacing("front")).toBe("front");
    expect(parseCameraFacing("back")).toBe("back");
  });

  it("rejects unknown values", () => {
    expect(parseCameraFacing("left")).toBeNull();
    expect(parseCameraFacing(1)).toBeNull();
    expect(parseCameraFacing(null)).toBeNull();
  });
});

describe("cameraFacingFromArgs", () => {
  it("defaults when omitted", () => {
    expect(cameraFacingFromArgs({})).toBe("default");
  });

  it("reads camera or facing", () => {
    expect(cameraFacingFromArgs({ camera: "front" })).toBe("front");
    expect(cameraFacingFromArgs({ facing: "back" })).toBe("back");
  });

  it("rejects bad values", () => {
    expect(cameraFacingFromArgs({ camera: "side" })).toEqual({
      error: "Camera must be default, front, or back.",
    });
  });
});

describe("cameraFacingLabel", () => {
  it("names each facing", () => {
    expect(cameraFacingLabel("default")).toBe("default camera");
    expect(cameraFacingLabel("front")).toBe("front camera");
    expect(cameraFacingLabel("back")).toBe("rear camera");
  });
});

describe("frame rate helpers", () => {
  it("never exceeds 1 FPS", () => {
    expect(clampCameraFps(30)).toBe(1);
    expect(clampCameraFps(1)).toBe(1);
    expect(clampCameraFps(undefined)).toBe(1);
    expect(cameraFrameIntervalMs(30)).toBe(1_000);
  });
});

describe("fitCameraEdge", () => {
  it("scales the long edge", () => {
    expect(fitCameraEdge(2560, 1440)).toEqual({ width: 1280, height: 720 });
  });

  it("refuses empty frames", () => {
    expect(() => fitCameraEdge(0, 10)).toThrow(/empty/);
  });
});

describe("assertCameraJpeg / validateCameraFrame", () => {
  it("accepts a tiny JPEG", () => {
    assertCameraJpeg(TINY_JPEG);
    expect(validateCameraFrame(frame())).toMatchObject({ width: 640, facing: "default" });
  });

  it("rejects non-JPEG", () => {
    expect(() => assertCameraJpeg(btoa("not-jpeg"))).toThrow(/could not be read/);
  });
});

describe("LatestFrameGate", () => {
  it("emits the first frame immediately", () => {
    const gate = new LatestFrameGate(1_000, () => 0);
    expect(gate.offer(frame({ capturedAt: "a" }))?.capturedAt).toBe("a");
  });

  it("keeps only the newest pending frame while rate-limited", () => {
    let now = 0;
    const gate = new LatestFrameGate(1_000, () => now);
    expect(gate.offer(frame({ capturedAt: "1" }))).not.toBeNull();
    expect(gate.offer(frame({ capturedAt: "2" }))).toBeNull();
    expect(gate.offer(frame({ capturedAt: "3" }))).toBeNull();
    now = 1_000;
    expect(gate.release()?.capturedAt).toBe("3");
  });

  it("drops stale frames while a send is in flight", () => {
    let now = 0;
    const gate = new LatestFrameGate(1_000, () => now);
    expect(gate.offer(frame({ capturedAt: "1" }))).not.toBeNull();
    gate.markSending();
    now = 5_000;
    expect(gate.offer(frame({ capturedAt: "2" }))).toBeNull();
    expect(gate.offer(frame({ capturedAt: "3" }))).toBeNull();
    expect(gate.release()?.capturedAt).toBe("3");
  });
});

describe("resolveCameraDevice", () => {
  const devices: CameraDevice[] = [
    { id: "a", label: "Front", facing: "front" },
    { id: "b", label: "Rear", facing: "back" },
  ];

  it("prefers an explicit device id", () => {
    expect(resolveCameraDevice(devices, "front", "b")?.id).toBe("b");
  });

  it("matches facing, then falls back to the first device", () => {
    expect(resolveCameraDevice(devices, "back")?.id).toBe("b");
    expect(resolveCameraDevice(devices, "default")?.id).toBe("a");
    expect(resolveCameraDevice([], "default")).toBeNull();
  });
});

describe("inferFacingFromLabel", () => {
  it("detects front and back keywords", () => {
    expect(inferFacingFromLabel("Integrated Front Camera")).toBe("front");
    expect(inferFacingFromLabel("USB Rear Webcam")).toBe("back");
    expect(inferFacingFromLabel("HD Webcam")).toBe("unknown");
  });
});
