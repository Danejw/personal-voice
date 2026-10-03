import type { CameraCapture } from "@/platform/camera/CameraCapture";
import {
  assertCameraJpeg,
  cameraFrameIntervalMs,
  fitCameraEdge,
  inferFacingFromLabel,
  LatestFrameGate,
  resolveCameraDevice,
} from "@/platform/camera/cameraLogic";
import type {
  CameraDevice,
  CameraFacing,
  CameraFrame,
  CapturePhotoOptions,
  StartFramesOptions,
} from "@/platform/camera/types";

const PHOTO_QUALITY = 0.92;
const FRAME_QUALITY = 0.8;

/**
 * Webcam capture via `navigator.mediaDevices.getUserMedia` in the Tauri WebView.
 * Used on Windows. Does not send frames to Gemini; callers decide transport.
 */
export class WebCameraCapture implements CameraCapture {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private gate: LatestFrameGate | null = null;
  private facing: CameraFacing | null = null;
  private label: string | undefined;
  private onFrame: ((frame: CameraFrame) => void) | null = null;
  private onError: ((message: string) => void) | null = null;
  private stopping: Promise<void> | null = null;

  async listDevices(): Promise<CameraDevice[]> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      throw new Error("Camera capture is unavailable in this app environment.");
    }
    // Labels are empty until camera permission has been granted once.
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      probe.getTracks().forEach((track) => track.stop());
    } catch (error) {
      throw cameraPermissionError(error);
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "videoinput")
      .map((device, index) => ({
        id: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
        facing: inferFacingFromLabel(device.label || ""),
      }));
  }

  async capturePhoto(options: CapturePhotoOptions = {}): Promise<CameraFrame> {
    const facing = options.facing ?? "default";
    const devices = await this.safeList();
    const chosen = resolveCameraDevice(devices, facing, options.deviceId);
    const stream = await openCamera(facing, chosen?.id ?? options.deviceId ?? null);
    try {
      const video = await attachVideo(stream);
      const frame = grabFrame(video, facing, chosen?.label, PHOTO_QUALITY);
      assertCameraJpeg(frame.jpeg);
      return frame;
    } finally {
      stream.getTracks().forEach((track) => track.stop());
    }
  }

  async startFrames(
    options: StartFramesOptions,
    onFrame: (frame: CameraFrame) => void,
    onError: (message: string) => void,
  ): Promise<void> {
    if (this.isActive()) await this.stop();
    const facing = options.facing ?? "default";
    const devices = await this.safeList();
    const chosen = resolveCameraDevice(devices, facing, options.deviceId);
    const stream = await openCamera(facing, chosen?.id ?? options.deviceId ?? null);
    const video = await attachVideo(stream);
    this.stream = stream;
    this.video = video;
    this.facing = facing;
    this.label = chosen?.label;
    this.onFrame = onFrame;
    this.onError = onError;
    this.gate = new LatestFrameGate(cameraFrameIntervalMs(options.maxFps));
    stream.getVideoTracks().forEach((track) => {
      track.onended = () => {
        if (this.isActive()) onError("The camera disconnected. Check the device and try again.");
      };
    });
    const interval = cameraFrameIntervalMs(options.maxFps);
    this.timer = setInterval(() => this.tick(), interval);
    this.tick();
  }

  async switchCamera(facing: CameraFacing): Promise<void> {
    if (!this.isActive()) throw new Error("Camera Context is not active.");
    const onFrame = this.onFrame;
    const onError = this.onError;
    if (!onFrame || !onError) throw new Error("Camera Context is not active.");
    await this.startFrames({ facing, deviceId: null }, onFrame, onError);
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this.release().finally(() => {
      this.stopping = null;
    });
    return this.stopping;
  }

  isActive(): boolean {
    return this.stream !== null;
  }

  activeFacing(): CameraFacing | null {
    return this.facing;
  }

  private async safeList(): Promise<CameraDevice[]> {
    try {
      return await this.listDevices();
    } catch {
      return [];
    }
  }

  private tick(): void {
    if (!this.video || !this.gate || !this.onFrame || !this.facing) return;
    try {
      const raw = grabFrame(this.video, this.facing, this.label, FRAME_QUALITY);
      const ready = this.gate.offer(raw);
      if (!ready) return;
      this.onFrame(ready);
    } catch (error) {
      this.onError?.(error instanceof Error ? error.message : "Couldn't capture a camera frame.");
    }
  }

  private async release(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.gate?.clear();
    this.gate = null;
    this.onFrame = null;
    this.onError = null;
    this.facing = null;
    this.label = undefined;
    const video = this.video;
    this.video = null;
    if (video) {
      video.srcObject = null;
      video.remove();
    }
    const stream = this.stream;
    this.stream = null;
    stream?.getTracks().forEach((track) => track.stop());
  }
}

async function openCamera(facing: CameraFacing, deviceId: string | null): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera capture is unavailable in this app environment.");
  }
  const video = videoConstraints(facing, deviceId);
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video });
  } catch (error) {
    if (deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: videoConstraints(facing, null),
        });
      } catch (fallback) {
        throw cameraPermissionError(fallback);
      }
    }
    throw cameraPermissionError(error);
  }
}

function videoConstraints(facing: CameraFacing, deviceId: string | null): MediaTrackConstraints {
  if (deviceId) return { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } };
  if (facing === "front") {
    return { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } };
  }
  if (facing === "back") {
    return { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } };
  }
  return { width: { ideal: 1280 }, height: { ideal: 720 } };
}

async function attachVideo(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.playsInline = true;
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  if (video.videoWidth < 1 || video.videoHeight < 1) {
    await waitForDimensions(video);
  }
  if (video.videoWidth < 1 || video.videoHeight < 1) {
    throw new Error("The camera image was empty.");
  }
  return video;
}

function waitForDimensions(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The camera image was empty.")), 3_000);
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

function grabFrame(
  video: HTMLVideoElement,
  facing: CameraFacing,
  label: string | undefined,
  quality: number,
): CameraFrame {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const target = fitCameraEdge(sourceWidth, sourceHeight);
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The camera image could not be read.");
  context.drawImage(video, 0, 0, target.width, target.height);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const prefix = "data:image/jpeg;base64,";
  if (!dataUrl.startsWith(prefix)) throw new Error("The camera image could not be read.");
  const jpeg = dataUrl.slice(prefix.length);
  assertCameraJpeg(jpeg);
  return {
    jpeg,
    width: target.width,
    height: target.height,
    capturedAt: new Date().toISOString(),
    facing,
    ...(label ? { label } : {}),
  };
}

function cameraPermissionError(error: unknown): Error {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") {
    return new Error("Camera permission was denied. Allow camera access and try again.", { cause: error });
  }
  if (name === "NotFoundError") {
    return new Error("No camera was found.", { cause: error });
  }
  if (name === "NotReadableError") {
    return new Error("The camera is busy or unavailable.", { cause: error });
  }
  return new Error("Could not open the camera. Check permissions and try again.", { cause: error });
}
