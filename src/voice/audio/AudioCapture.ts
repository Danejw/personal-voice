export type CapturePurpose = "dictation" | "assistant";

export interface CaptureOptions {
  purpose?: CapturePurpose;
}

/**
 * What the capture path could actually confirm.
 * `fullDuplex` is true only when echo cancellation is enabled and playback shares its reference.
 * A void result means the caller did not probe (desktop capture, tests) and barge-in stays open.
 */
export interface CaptureEchoStatus {
  fullDuplex: boolean;
  /** Assistant PCM is played on the native voice-communication output. */
  nativePlayback: boolean;
  /** Noise suppression is enabled. It does not identify the user's voice. */
  noiseSuppression: boolean;
}

export function captureEchoFrom(status: CaptureEchoStatus | void): CaptureEchoStatus {
  if (!status) return { fullDuplex: true, nativePlayback: false, noiseSuppression: false };
  return {
    fullDuplex: status.fullDuplex === true,
    nativePlayback: status.nativePlayback === true,
    noiseSuppression: status.noiseSuppression === true,
  };
}

export interface AudioCapture {
  start(onChunk: (pcm: ArrayBuffer) => void, onError: (message: string) => void): Promise<CaptureEchoStatus | void>;
  /** Flush the final partial chunk before resolving, unless cancelling. */
  stop(flush: boolean): Promise<void>;
}
