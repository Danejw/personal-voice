import type { CameraCapture } from "@/platform/camera/CameraCapture";
import type { CameraFacing, CameraFrame, CapturePhotoOptions, StartFramesOptions } from "@/platform/camera/types";

const UNAVAILABLE = "Camera capture is not available on this device.";

/** Honest stub used until a platform implementation is wired. */
export class UnavailableCameraCapture implements CameraCapture {
  listDevices() {
    return Promise.reject(new Error(UNAVAILABLE));
  }

  capturePhoto(_options?: CapturePhotoOptions): Promise<CameraFrame> {
    void _options;
    return Promise.reject(new Error(UNAVAILABLE));
  }

  startFrames(
    options: StartFramesOptions,
    onFrame: (frame: CameraFrame) => void,
    onError: (message: string) => void,
  ) {
    void options;
    void onFrame;
    void onError;
    return Promise.reject(new Error(UNAVAILABLE));
  }

  switchCamera(facing: CameraFacing) {
    void facing;
    return Promise.reject(new Error(UNAVAILABLE));
  }

  stop() {
    return Promise.resolve();
  }

  isActive() {
    return false;
  }

  activeFacing() {
    return null;
  }
}
