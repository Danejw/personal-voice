import type {
  CameraDevice,
  CameraFacing,
  CameraFrame,
  CapturePhotoOptions,
  StartFramesOptions,
} from "@/platform/camera/types";

/**
 * Platform camera boundary. Separate from microphone `AudioCapture` and from screen snapshots.
 * AssistantController talks only to this interface.
 */
export interface CameraCapture {
  listDevices(): Promise<CameraDevice[]>;
  capturePhoto(options?: CapturePhotoOptions): Promise<CameraFrame>;
  /**
   * Starts sampled JPEG frames. Implementations must never emit faster than 1 FPS,
   * drop stale frames when encoding lags, and release hardware on `stop`.
   */
  startFrames(
    options: StartFramesOptions,
    onFrame: (frame: CameraFrame) => void,
    onError: (message: string) => void,
  ): Promise<void>;
  /** Switches facing while frames are active when the platform supports it. */
  switchCamera(facing: CameraFacing): Promise<void>;
  stop(): Promise<void>;
  isActive(): boolean;
  activeFacing(): CameraFacing | null;
}
