/**
 * One explicit camera still for Assistant. Separate from screen screenshots.
 * JPEG stays in memory only; never written to conversations, memories, or storage.
 */

import {
  assertCameraJpeg,
  cameraFacingLabel,
  fitCameraEdge,
  parseCameraFacing,
  type CameraFacing,
} from "@/platform/camera";
import type { CameraFrame } from "@/platform/camera";

export interface CameraPhoto {
  facing: CameraFacing;
  label?: string;
  capturedAt: string;
  /** Raw JPEG bytes as base64, without a data-URL prefix. */
  jpeg: string;
  width: number;
  height: number;
}

export function cameraPhotoFromFrame(frame: CameraFrame): CameraPhoto {
  assertCameraJpeg(frame.jpeg);
  fitCameraEdge(frame.width, frame.height);
  const facing = parseCameraFacing(frame.facing) ?? "default";
  return {
    facing,
    ...(frame.label ? { label: frame.label } : {}),
    capturedAt: frame.capturedAt,
    jpeg: frame.jpeg,
    width: frame.width,
    height: frame.height,
  };
}

/** Context note. The image itself is a separate Live video frame. */
export function cameraPhotoContextText(photo: Pick<CameraPhoto, "facing" | "label" | "capturedAt">): string {
  const where = photo.label ?? cameraFacingLabel(photo.facing);
  return `Camera photo captured from ${where} at ${photo.capturedAt}. This is a still from the device camera, not a screenshot of the screen. It stays the active camera image for later questions in this session until capture_camera_photo runs again or Camera Context is started. Do not describe a camera image that was not captured. Do not treat this as screen content. Do not include it in a web search unless the user asks you to look up something public that is visible in it.`;
}

export function cameraPhotoDetachedText(): string {
  return "The attached camera photo was removed. It is not active context. Do not describe that image unless the user captures it again.";
}

export function cameraContextStartedText(facing: CameraFacing, label?: string): string {
  const where = label ?? cameraFacingLabel(facing);
  return `Camera Context is on using the ${where}. Fresh camera frames are sent as realtime visual input while the user continues talking. This is live camera context, not a screenshot and not a saved attachment. Do not assume older frames are still accurate. Observation is not authorization to click, type, or change the device. Call stop_camera_context when the user asks to turn the camera off.`;
}

export function cameraContextStoppedText(): string {
  return "Camera Context is off. The live camera is no longer sending frames. Do not describe what the camera sees unless the user starts Camera Context or captures a camera photo again.";
}

export function cameraContextPreviewUrl(photo: Pick<CameraPhoto, "jpeg">): string {
  return `data:image/jpeg;base64,${photo.jpeg}`;
}
