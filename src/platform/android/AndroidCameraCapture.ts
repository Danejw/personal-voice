import { callPlugin, listenPlugin } from "@/platform/android/voicePlatformPlugin";
import type { CameraCapture } from "@/platform/camera/CameraCapture";
import { assertCameraJpeg, parseCameraFacing } from "@/platform/camera/cameraLogic";
import type {
  CameraDevice,
  CameraFacing,
  CameraFrame,
  CapturePhotoOptions,
  StartFramesOptions,
} from "@/platform/camera/types";

/**
 * Bridge to Kotlin CameraX (`VoicePlatformPlugin`). Brings the app forward before capture
 * so Android can show the camera permission prompt and the visible preview pill.
 */
export class AndroidCameraCapture implements CameraCapture {
  private active = false;
  private facing: CameraFacing | null = null;
  private unlistenFrame: (() => void) | null = null;
  private unlistenError: (() => void) | null = null;

  async listDevices(): Promise<CameraDevice[]> {
    const payload = await callPlugin<{ devices?: unknown }>("list_cameras");
    const devices = Array.isArray(payload?.devices) ? payload.devices : [];
    const out: CameraDevice[] = [];
    for (const row of devices) {
      if (typeof row !== "object" || row === null) continue;
      const record = row as { id?: unknown; label?: unknown; facing?: unknown };
      if (typeof record.id !== "string" || !record.id) continue;
      const facing = parseCameraFacing(record.facing) ?? "unknown";
      out.push({
        id: record.id,
        label: typeof record.label === "string" && record.label ? record.label : record.id,
        facing: facing === "default" ? "unknown" : facing,
      });
    }
    return out;
  }

  async capturePhoto(options: CapturePhotoOptions = {}): Promise<CameraFrame> {
    const facing = options.facing ?? "default";
    const payload = await callPlugin<unknown>("capture_camera_photo", { facing });
    return parseCameraFrame(payload, facing);
  }

  async startFrames(
    options: StartFramesOptions,
    onFrame: (frame: CameraFrame) => void,
    onError: (message: string) => void,
  ): Promise<void> {
    if (this.active) await this.stop();
    const facing = options.facing ?? "default";
    this.unlistenFrame = await listenPlugin("cameraFrame", (payload) => {
      try {
        onFrame(parseCameraFrame(payload, this.facing ?? facing));
      } catch (error) {
        onError(error instanceof Error ? error.message : "Couldn't read a camera frame.");
      }
    });
    this.unlistenError = await listenPlugin("cameraError", (payload) => {
      const message = typeof payload === "object" && payload !== null
        ? (payload as { message?: unknown }).message
        : null;
      onError(typeof message === "string" && message ? message : "Camera Context failed.");
    });
    await callPlugin("start_camera_frames", { facing });
    this.active = true;
    this.facing = facing;
  }

  async switchCamera(facing: CameraFacing): Promise<void> {
    if (!this.active) throw new Error("Camera Context is not active.");
    await callPlugin("switch_camera", { facing });
    this.facing = facing;
  }

  async stop(): Promise<void> {
    this.unlistenFrame?.();
    this.unlistenError?.();
    this.unlistenFrame = null;
    this.unlistenError = null;
    if (this.active) {
      try {
        await callPlugin("stop_camera_frames");
      } catch {
        // Hardware may already be released on destroy.
      }
    }
    this.active = false;
    this.facing = null;
  }

  isActive(): boolean {
    return this.active;
  }

  activeFacing(): CameraFacing | null {
    return this.facing;
  }
}

function parseCameraFrame(payload: unknown, fallbackFacing: CameraFacing): CameraFrame {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("The camera image could not be read.");
  }
  const record = payload as {
    jpeg?: unknown;
    width?: unknown;
    height?: unknown;
    facing?: unknown;
    capturedAt?: unknown;
    label?: unknown;
  };
  if (typeof record.jpeg !== "string" || !record.jpeg) {
    throw new Error("The camera image could not be read.");
  }
  assertCameraJpeg(record.jpeg);
  const width = typeof record.width === "number" ? record.width : 0;
  const height = typeof record.height === "number" ? record.height : 0;
  if (width < 1 || height < 1) throw new Error("The camera image was empty.");
  const facing = parseCameraFacing(record.facing) ?? fallbackFacing;
  const capturedAt = typeof record.capturedAt === "string" && record.capturedAt
    ? record.capturedAt
    : new Date().toISOString();
  return {
    jpeg: record.jpeg,
    width,
    height,
    capturedAt,
    facing,
    ...(typeof record.label === "string" && record.label ? { label: record.label } : {}),
  };
}
