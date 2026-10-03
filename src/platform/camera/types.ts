/**
 * Shared camera types. Platform implementations live behind `CameraCapture`.
 * Frames stay in memory; nothing here writes to disk or Supabase.
 */

/** Human-facing camera intent. Platform code maps this to hardware. */
export type CameraFacing = "default" | "front" | "back";

export type CameraDeviceFacing = CameraFacing | "unknown";

export interface CameraDevice {
  id: string;
  label: string;
  facing: CameraDeviceFacing;
}

/** One JPEG still or sampled frame. `jpeg` is raw base64 without a data-URL prefix. */
export interface CameraFrame {
  jpeg: string;
  width: number;
  height: number;
  capturedAt: string;
  facing: CameraFacing;
  label?: string;
}

export interface CapturePhotoOptions {
  facing?: CameraFacing;
  /** Windows may pass an explicit webcam id. Android resolves facing instead. */
  deviceId?: string | null;
}

export interface StartFramesOptions {
  facing?: CameraFacing;
  deviceId?: string | null;
  /**
   * Requested output rate. Clamped to Gemini Live's documented maximum of 1 FPS
   * (https://ai.google.dev/gemini-api/docs/live-api/capabilities).
   */
  maxFps?: number;
}
