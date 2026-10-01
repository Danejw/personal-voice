import type { AssistantPlayback } from "@/assistant/playback";
import { ASSISTANT_PCM_RATE } from "@/assistant/protocol";

interface PlaybackBuffer {
  duration: number;
  getChannelData(channel: number): Float32Array;
}

interface PlaybackSource {
  buffer: PlaybackBuffer | null;
  connect(destination: unknown): void;
  start(when: number): void;
  stop(): void;
}

interface PlaybackContext {
  currentTime: number;
  readonly state: string;
  destination: unknown;
  createBuffer(channels: number, length: number, sampleRate: number): PlaybackBuffer;
  createBufferSource(): PlaybackSource;
  resume(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Plays Gemini's PCM16 chunks in order through Web Audio.
 * Nothing is written to disk. A playback failure is swallowed so the session can continue.
 */
export class PcmPlayback implements AssistantPlayback {
  private ctx?: PlaybackContext;
  private nextStart = 0;
  private active: PlaybackSource[] = [];

  constructor(private createContext: () => PlaybackContext = defaultContext) {}

  /** Creates the audio context during the Start click so later chunks can play. */
  prime(): void {
    try {
      const ctx = this.context();
      void ctx.resume().catch(() => undefined);
    } catch {
      // The next chunk reports nothing and the app stays up.
    }
  }

  /** Schedules one little-endian PCM16 chunk after whatever is already queued. */
  enqueue(pcm: ArrayBuffer, sampleRate = ASSISTANT_PCM_RATE): void {
    if (pcm.byteLength < 2) return;
    try {
      const ctx = this.context();
      if (ctx.state === "suspended") {
        void ctx.resume().then(() => {
          if (this.ctx === ctx && ctx.state !== "suspended") this.enqueue(pcm, sampleRate);
        }).catch(() => undefined);
        return;
      }
      const samples = Math.floor(pcm.byteLength / 2);
      const buffer = ctx.createBuffer(1, samples, sampleRate);
      const channel = buffer.getChannelData(0);
      const view = new DataView(pcm);
      for (let index = 0; index < samples; index += 1) {
        channel[index] = view.getInt16(index * 2, true) / 32768;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      const startAt = Math.max(ctx.currentTime, this.nextStart);
      source.start(startAt);
      this.nextStart = startAt + buffer.duration;
      this.active.push(source);
    } catch {
      // A bad chunk or a missing audio device must not take down the page.
    }
  }

  /** Milliseconds still scheduled on the audio clock. Zero after clear or when the queue has played out. */
  pendingMs(): number {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "closed") return 0;
    return Math.max(0, (this.nextStart - ctx.currentTime) * 1000);
  }

  /** Stops queued audio immediately. Used when Assistant ends or a reply is interrupted. */
  clear(): void {
    const ctx = this.ctx;
    this.ctx = undefined;
    this.nextStart = 0;
    const sources = this.active;
    this.active = [];
    for (const source of sources) {
      try { source.stop(); } catch { /* already finished */ }
    }
    if (ctx) void ctx.close().catch(() => undefined);
  }

  private context(): PlaybackContext {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = this.createContext();
      this.nextStart = 0;
    }
    return this.ctx;
  }
}

function defaultContext(): PlaybackContext {
  return new AudioContext() as unknown as PlaybackContext;
}
