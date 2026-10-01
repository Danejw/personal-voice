import type { AssistantPlayback } from "@/assistant/playback";
import { ASSISTANT_PCM_RATE } from "@/assistant/protocol";
import { PcmPlayback } from "@/assistant/PcmPlayback";
import { callPlugin, listenPlugin } from "@/platform/android/voicePlatformPlugin";

/** Keep the mic closed this long after a local estimate hits zero if the device never reports drained. */
const DRAIN_GRACE_MS = 250;

interface PlaybackEvent {
  kind: "remaining" | "drained" | "cleared" | "duplex";
  remainingMs: number;
  token: number;
  fullDuplex: boolean;
  nativePlayback: boolean;
}

/**
 * Plays Assistant replies on the Android voice-communication track when that track is open,
 * so acoustic echo cancellation hears the same signal as the speaker. Otherwise it uses
 * Web Audio and the controller withholds the microphone until playback finishes.
 */
export class AndroidAssistantPlayback implements AssistantPlayback {
  private readonly web = new PcmPlayback();
  private route: "pending" | "native" | "web" = "pending";
  private queued: ArrayBuffer[] = [];
  private token = 0;
  /** `clear` bumps the token. A later `cleared` event must not wipe audio enqueued after that. */
  private clearToken = -1;
  private remainingMs = 0;
  private remainingAt = 0;
  private listening = false;
  private audible: () => void = () => undefined;
  private duplex: (fullDuplex: boolean, nativePlayback: boolean) => void = () => undefined;

  prime(): void {
    this.web.prime();
    if (this.listening) return;
    this.listening = true;
    void listenPlugin("assistantPlayback", (payload) => this.onEvent(payload)).catch(() => undefined);
  }

  setNativeRoute(ready: boolean): void {
    this.route = ready ? "native" : "web";
    if (!ready) this.web.prime();
    const pending = this.queued;
    this.queued = [];
    for (const pcm of pending) this.send(pcm, ASSISTANT_PCM_RATE);
    this.audible();
  }

  onAudibleChange(listener: () => void): void {
    this.audible = listener;
  }

  onDuplexChange(listener: (fullDuplex: boolean, nativePlayback: boolean) => void): void {
    this.duplex = listener;
  }

  enqueue(pcm: ArrayBuffer, sampleRate = ASSISTANT_PCM_RATE): void {
    if (pcm.byteLength < 2) return;
    this.account(pcm.byteLength, sampleRate);
    this.send(pcm, sampleRate);
    this.audible();
  }

  clear(): void {
    this.token += 1;
    this.clearToken = this.token;
    this.queued = [];
    this.remainingMs = 0;
    this.remainingAt = Date.now();
    this.web.clear();
    if (this.route === "native") void callPlugin("clear_assistant_playback").catch(() => undefined);
    this.audible();
  }

  pendingMs(now = Date.now()): number {
    if (this.route === "web") return this.web.pendingMs();
    if (this.remainingMs <= 0) return 0;
    const elapsed = now - this.remainingAt;
    const left = this.remainingMs - elapsed;
    if (left > 0) return left;
    if (elapsed >= this.remainingMs + DRAIN_GRACE_MS) return 0;
    return 1;
  }

  private account(byteLength: number, sampleRate: number): void {
    const now = Date.now();
    const duration = (byteLength / 2) / sampleRate * 1000;
    this.remainingMs = this.pendingMs(now) + duration;
    this.remainingAt = now;
  }

  private send(pcm: ArrayBuffer, sampleRate: number): void {
    if (this.route === "pending") {
      this.queued.push(pcm);
      return;
    }
    if (this.route === "web" || sampleRate !== ASSISTANT_PCM_RATE) {
      this.web.enqueue(pcm, sampleRate);
      return;
    }
    this.token += 1;
    void callPlugin("enqueue_assistant_playback", {
      data: arrayBufferToBase64(pcm),
      token: this.token,
    }).catch(() => undefined);
  }

  private onEvent(payload: unknown): void {
    const event = parsePlaybackEvent(payload);
    if (!event) return;
    if (event.kind === "duplex") {
      this.duplex(event.fullDuplex, event.nativePlayback);
      return;
    }
    if (event.kind === "cleared") {
      if (this.token !== this.clearToken) return;
      this.remainingMs = 0;
      this.remainingAt = Date.now();
      this.audible();
      return;
    }
    if (event.token !== this.token) return;
    this.remainingMs = Math.max(0, event.remainingMs);
    this.remainingAt = Date.now();
    this.audible();
  }
}

export function parsePlaybackEvent(payload: unknown): PlaybackEvent | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as { kind?: unknown; remainingMs?: unknown; token?: unknown; fullDuplex?: unknown; nativePlayback?: unknown };
  if (record.kind !== "remaining" && record.kind !== "drained" && record.kind !== "cleared" && record.kind !== "duplex") return null;
  return {
    kind: record.kind,
    remainingMs: typeof record.remainingMs === "number" ? record.remainingMs : 0,
    token: typeof record.token === "number" ? record.token : -1,
    fullDuplex: record.fullDuplex === true,
    nativePlayback: record.nativePlayback === true,
  };
}

export function arrayBufferToBase64(pcm: ArrayBuffer): string {
  const bytes = new Uint8Array(pcm);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index] ?? 0);
  return btoa(binary);
}
