export type { CameraCapture } from "@/platform/camera/CameraCapture";
export {
  assertCameraJpeg,
  CAMERA_MAX_BYTES,
  CAMERA_MAX_EDGE,
  CAMERA_MAX_FPS,
  CAMERA_MIN_INTERVAL_MS,
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
export { UnavailableCameraCapture } from "@/platform/camera/UnavailableCameraCapture";
export { WebCameraCapture } from "@/platform/camera/WebCameraCapture";
export type {
  CameraDevice,
  CameraDeviceFacing,
  CameraFacing,
  CameraFrame,
  CapturePhotoOptions,
  StartFramesOptions,
} from "@/platform/camera/types";
