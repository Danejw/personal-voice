import { callPlugin, listenPlugin } from "@/platform/android/voicePlatformPlugin";
import type { AudioCapture } from "@/voice/audio/AudioCapture";

export type CaptureEvent =
  | { kind: "chunk"; id: number; pcm: ArrayBuffer }
  | { kind: "error"; id: number; message: string }
  | { kind: "end"; id: number };

const END_TIMEOUT_MS = 2000;
let nextCaptureId = 1;

export function base64ToArrayBuffer(data: string): ArrayBuffer {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

/** Validates an `audioCapture` plugin event; anything malformed is ignored. */
export function parseCaptureEvent(payload: unknown): CaptureEvent | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { id, kind, data, message } = payload as { id?: unknown; kind?: unknown; data?: unknown; message?: unknown };
  if (typeof id !== "number") return null;
  if (kind === "chunk" && typeof data === "string") return { kind, id, pcm: base64ToArrayBuffer(data) };
  if (kind === "error" && typeof message === "string") return { kind, id, message };
  if (kind === "end") return { kind, id };
  return null;
}

/**
 * Microphone capture through the Kotlin plugin (`NativeMicCapture`): 16 kHz PCM16 chunks, the
 * same format as `BrowserAudioCapture`. Native because the WebView's `getUserMedia` stalls while
 * the app is hidden behind the floating mic.
 */
export class NativeAudioCapture implements AudioCapture {
  private readonly id = nextCaptureId++;
  private unlisten?: () => void;
  private stopped = false;
  private discard = false;
  private ended = false;
  private onEnd?: () => void;
  private stopping?: Promise<void>;

  async start(onChunk: (pcm: ArrayBuffer) => void, onError: (message: string) => void) {
    const unlisten = await listenPlugin("audioCapture", (payload) => {
      const event = parseCaptureEvent(payload);
      if (!event || event.id !== this.id) return;
      switch (event.kind) {
        case "chunk": if (!this.discard) onChunk(event.pcm); return;
        case "error": if (!this.stopped) onError(event.message); return;
        case "end": this.ended = true; this.onEnd?.(); return;
        default: {
          const unhandled: never = event;
          throw new Error(`Unhandled capture event: ${String(unhandled)}`);
        }
      }
    });
    if (this.stopped) {
      unlisten();
      throw new Error("Recording cancelled.");
    }
    this.unlisten = unlisten;
    await callPlugin("start_capture", { id: this.id });
  }

  stop(flush: boolean): Promise<void> {
    this.stopped = true;
    if (!flush) this.discard = true;
    this.stopping ??= this.finish(flush);
    return this.stopping;
  }

  /** The `end` event follows the last chunk, so waiting for it is the flush. */
  private async finish(flush: boolean) {
    // Stopped before listening: `start` sees `stopped` and never starts the native capture.
    if (!this.unlisten) return;
    const ended = new Promise<boolean>((resolve) => {
      if (this.ended) resolve(true);
      else this.onEnd = () => resolve(true);
      setTimeout(() => resolve(false), END_TIMEOUT_MS);
    });
    try {
      await callPlugin("stop_capture", { id: this.id });
      if (!(await ended) && flush) throw new Error("Audio flush timed out.");
    } finally {
      this.unlisten?.();
    }
  }
}
