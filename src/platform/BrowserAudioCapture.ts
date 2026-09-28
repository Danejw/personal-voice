import type { AudioCapture } from "@/voice/audio/AudioCapture";
import { PCM_SAMPLE_RATE } from "@/voice/audio/pcm";
import workletUrl from "@/voice/audio/pcm-worklet.ts?worker&url";

const VOICE_AUDIO: MediaTrackConstraints = { channelCount: 1, echoCancellation: true, noiseSuppression: true };

/**
 * Opens the chosen microphone, or the system default when none is chosen or it's unplugged.
 * `exact` is required: WebView2 treats an `ideal` deviceId as a hint and opens the default anyway.
 */
async function openMicrophone(deviceId: string | null): Promise<MediaStream> {
  const media = navigator.mediaDevices;
  if (!deviceId) return media.getUserMedia({ audio: VOICE_AUDIO, video: false });
  try {
    return await media.getUserMedia({ audio: { ...VOICE_AUDIO, deviceId: { exact: deviceId } }, video: false });
  } catch (error) {
    const missing = error instanceof DOMException && (error.name === "OverconstrainedError" || error.name === "NotFoundError");
    if (!missing) throw error;
    return media.getUserMedia({ audio: VOICE_AUDIO, video: false });
  }
}

/** Shared Web Audio capture for the foreground Tauri webview. No provider knowledge. */
export class BrowserAudioCapture implements AudioCapture {
  private context?: AudioContext;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private node?: AudioWorkletNode;
  private stopped = false;
  private stopping?: Promise<void>;

  /** `deviceId` is `null` for the system default; an unplugged choice falls back to it. */
  constructor(private deviceId: string | null = null) {}

  async start(onChunk: (chunk: ArrayBuffer) => void, onError: (message: string) => void) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone capture is unavailable in this app environment.");
    try {
      // Create/resume synchronously from the Record gesture. The browser resamples
      // the hardware input into this context's verified 16 kHz sample rate.
      const context = this.context = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
      const resumed = context.resume();
      void resumed.catch(() => undefined);
      const stream = await openMicrophone(this.deviceId);
      if (this.stopped) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("Recording cancelled.");
      }
      this.stream = stream;
      await resumed;
      if (context.sampleRate !== PCM_SAMPLE_RATE) throw new Error("This audio device cannot provide 16 kHz audio.");
      await context.audioWorklet.addModule(workletUrl);
      if (this.stopped) throw new Error("Recording cancelled.");
      const node = this.node = new AudioWorkletNode(context, "voice-pcm", {
        channelCount: 1, channelCountMode: "explicit", outputChannelCount: [1],
      });
      node.port.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data instanceof ArrayBuffer) onChunk(event.data);
      };
      node.onprocessorerror = () => onError("Audio capture stopped unexpectedly. Try recording again.");
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => { if (!this.stopped) onError("The microphone disconnected. Check the device and try again."); };
      });
      this.source = context.createMediaStreamSource(stream);
      this.source.connect(node);
      node.connect(context.destination); // Processor emits silence, never microphone playback.
    } catch (error) {
      await this.stop(false);
      const name = error instanceof DOMException ? error.name : "";
      const message =
        name === "NotAllowedError" ? "Microphone permission was denied. Allow microphone access and try again."
        : name === "NotFoundError" ? "No microphone was found."
        : name === "NotReadableError" ? "The microphone is busy or unavailable."
        : "Could not start microphone capture. Check permissions and your audio device.";
      throw new Error(message, { cause: error });
    }
  }

  stop(flush: boolean): Promise<void> {
    this.stopped = true;
    this.stopping ??= this.release(flush);
    return this.stopping;
  }

  private async release(flush: boolean) {
    const node = this.node;
    try {
      if (flush && node && this.context?.state === "running") {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { node.port.removeEventListener("message", listener); reject(new Error("Audio flush timed out.")); }, 2000);
          const listener = (event: MessageEvent<unknown>) => {
            if (event.data === "flushed") {
              clearTimeout(timer);
              node.port.removeEventListener("message", listener);
              resolve();
            }
          };
          node.port.addEventListener("message", listener);
          node.port.postMessage("flush");
        });
      }
    } finally {
      this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
      this.source?.disconnect();
      node?.disconnect();
      node?.port.close();
      if (this.context && this.context.state !== "closed") await this.context.close();
    }
  }
}
