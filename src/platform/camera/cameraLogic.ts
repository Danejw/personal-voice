import type { CameraDevice, CameraFacing, CameraFrame } from "@/platform/camera/types";

/** Gemini Live documents a maximum of 1 video frame per second. */
export const CAMERA_MAX_FPS = 1;
export const CAMERA_MIN_INTERVAL_MS = 1_000;
/** Encoded JPEG budget, matching Assistant screenshot limits. */
export const CAMERA_MAX_BYTES = 1_000_000;
export const CAMERA_MAX_EDGE = 1_280;
export const CAMERA_MAX_DIMENSION = 8_000;

/** Parses tool / UI facing strings. Unknown values are rejected. */
export function parseCameraFacing(value: unknown): CameraFacing | null {
  if (value === "default" || value === "front" || value === "back") return value;
  return null;
}

/** Reads `camera` from a plain args object. Missing means default. */
export function cameraFacingFromArgs(args: Record<string, unknown>): CameraFacing | { error: string } {
  if (!("camera" in args) && !("facing" in args)) return "default";
  const raw = args.camera ?? args.facing;
  if (raw === undefined || raw === null || raw === "") return "default";
  const facing = parseCameraFacing(raw);
  if (!facing) return { error: "Camera must be default, front, or back." };
  return facing;
}

export function cameraFacingLabel(facing: CameraFacing): string {
  switch (facing) {
    case "default":
      return "default camera";
    case "front":
      return "front camera";
    case "back":
      return "rear camera";
    default: {
      const unhandled: never = facing;
      throw new Error(`Unhandled camera facing: ${String(unhandled)}`);
    }
  }
}

/** Clamps a requested FPS to the Live API maximum. */
export function clampCameraFps(maxFps?: number): number {
  if (typeof maxFps !== "number" || !Number.isFinite(maxFps) || maxFps <= 0) return CAMERA_MAX_FPS;
  return Math.min(CAMERA_MAX_FPS, maxFps);
}

export function cameraFrameIntervalMs(maxFps?: number): number {
  return Math.max(CAMERA_MIN_INTERVAL_MS, Math.round(1_000 / clampCameraFps(maxFps)));
}

/** Scales so the long edge fits. Empty or huge frames are refused. */
export function fitCameraEdge(width: number, height: number, maxEdge = CAMERA_MAX_EDGE): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("The camera image was empty.");
  }
  if (width > CAMERA_MAX_DIMENSION || height > CAMERA_MAX_DIMENSION) {
    throw new Error("That camera image is too large.");
  }
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const scale = maxEdge / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Validates raw JPEG base64. Does not log the payload. */
export function assertCameraJpeg(jpeg: string): void {
  let bytes: Uint8Array;
  try {
    const binary = atob(jpeg);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  } catch {
    throw new Error("The camera image could not be read.");
  }
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error("The camera image could not be read.");
  }
  if (bytes.length > CAMERA_MAX_BYTES) throw new Error("That camera image is too large to send.");
}

export function validateCameraFrame(frame: CameraFrame): CameraFrame {
  assertCameraJpeg(frame.jpeg);
  fitCameraEdge(frame.width, frame.height);
  if (!parseCameraFacing(frame.facing)) throw new Error("The camera facing was invalid.");
  if (typeof frame.capturedAt !== "string" || !frame.capturedAt) {
    throw new Error("The camera image could not be read.");
  }
  return frame;
}

/**
 * Rate gate for sampled frames. Newest frame wins when encoding or sending is slow;
 * there is never an unbounded queue.
 */
export class LatestFrameGate {
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private pending: CameraFrame | null = null;
  private sending = false;

  constructor(
    private intervalMs: number = CAMERA_MIN_INTERVAL_MS,
    private now: () => number = () => Date.now(),
  ) {}

  /** Offer a frame. Returns the frame to emit now, or null when it should wait / be replaced. */
  offer(frame: CameraFrame): CameraFrame | null {
    const elapsed = this.now() - this.lastSentAt;
    if (this.sending || elapsed < this.intervalMs) {
      this.pending = frame;
      return null;
    }
    this.lastSentAt = this.now();
    return frame;
  }

  /** Call when a prior emit finished. Returns the newest pending frame if the interval allows. */
  release(): CameraFrame | null {
    this.sending = false;
    if (!this.pending) return null;
    const elapsed = this.now() - this.lastSentAt;
    if (elapsed < this.intervalMs) return null;
    const next = this.pending;
    this.pending = null;
    this.lastSentAt = this.now();
    return next;
  }

  markSending(): void {
    this.sending = true;
  }

  clear(): void {
    this.pending = null;
    this.sending = false;
    this.lastSentAt = Number.NEGATIVE_INFINITY;
  }
}

/** Pick a device for the requested facing. Explicit deviceId wins when present. */
export function resolveCameraDevice(
  devices: readonly CameraDevice[],
  facing: CameraFacing,
  deviceId?: string | null,
): CameraDevice | null {
  if (deviceId) {
    const exact = devices.find((device) => device.id === deviceId);
    if (exact) return exact;
  }
  if (facing === "front" || facing === "back") {
    const match = devices.find((device) => device.facing === facing);
    if (match) return match;
  }
  return devices[0] ?? null;
}

/** Infer facing from a browser label when `getUserMedia` facingMode is unavailable. */
export function inferFacingFromLabel(label: string): CameraDevice["facing"] {
  const lower = label.toLowerCase();
  if (/\b(front|user|face|selfie)\b/.test(lower)) return "front";
  if (/\b(back|rear|environment|world)\b/.test(lower)) return "back";
  return "unknown";
}
