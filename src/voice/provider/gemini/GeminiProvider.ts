import { PCM_BYTES_PER_MS } from "@/voice/audio/pcm";
import type {
  TranscriptionEvent, TranscriptionPreferences, TranscriptionSession, VoiceProvider,
} from "@/voice/provider/VoiceProvider";
import { CredentialError } from "@/voice/provider/gemini/GeminiTokenSource";

/** Verified against https://ai.google.dev/gemini-api/docs/live-api/live-transcribe (Sep 2026). */
export const GEMINI_MODEL = "gemini-3.5-transcribe-live";
/** Ephemeral tokens only work on the constrained v1alpha endpoint (https://ai.google.dev/api/live#ephemeral-auth-tokens). */
const ENDPOINT = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";
const CONNECT_TIMEOUT_MS = 15_000;
const FINAL_TIMEOUT_MS = 10_000;
/** WebSocket close codes that mean the request itself was refused (bad argument, bad token/permission). */
const REFUSED_CLOSE_CODES = new Set([1007, 1008]);
/** Recovery replays buffered audio in half-second messages, throttled by the socket's send buffer. */
const REPLAY_CHUNK_BYTES = 500 * PCM_BYTES_PER_MS;
const REPLAY_MAX_BUFFERED = 64_000;
const CONGESTED_BUFFERED = 256_000;

export interface GeminiConfig {
  smart: boolean;
  languageCodes: string[];
  vocabulary: string[];
}
const defaultConfig: GeminiConfig = { smart: true, languageCodes: [], vocabulary: [] };

/** `language: null` means automatic detection, which Gemini expresses as no language codes. */
export function geminiConfigFrom(preferences: TranscriptionPreferences): GeminiConfig {
  return {
    smart: preferences.smart,
    languageCodes: preferences.language ? [preferences.language] : [],
    vocabulary: preferences.vocabulary,
  };
}

/** Supplies one fresh, single-use Live token per session. */
export interface GeminiCredentials {
  take(): Promise<string>;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

/** Google API keys and ephemeral tokens must never reach the UI through a server message. */
function redact(text: string): string {
  return text.replace(/AIza[0-9A-Za-z_-]{20,}|auth_tokens\/[0-9A-Za-z_-]+/g, "[redacted]").slice(0, 200);
}

export function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function setupMessage(config: GeminiConfig) {
  return { setup: {
    model: `models/${GEMINI_MODEL}`,
    generationConfig: { responseModalities: ["TEXT"] },
    inputAudioTranscription: {
      mode: config.smart ? "SMART" : "VERBATIM",
      languageCodes: config.languageCodes,
      ...(config.vocabulary.length ? { customVocabulary: config.vocabulary } : {}),
    },
    // Push-to-talk: the app delimits the utterance with activityStart/activityEnd.
    realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
  } };
}

/** Connects directly to Gemini Live with short-lived tokens; no permanent key exists on the client. */
export class GeminiProvider implements VoiceProvider {
  constructor(private credentials: GeminiCredentials, private config: GeminiConfig = defaultConfig) {}

  createSession(onEvent: (event: TranscriptionEvent) => void): TranscriptionSession {
    return new GeminiSession(() => this.credentials.take(), this.config, onEvent);
  }

  /**
   * Recovery: ephemeral tokens are Live-only, so the buffered utterance is replayed
   * into a fresh Live session (new token) instead of a non-streaming endpoint.
   */
  async transcribeRecording(pcm: ArrayBuffer, signal: AbortSignal): Promise<string> {
    let settle!: { resolve: (text: string) => void; reject: (error: Error) => void };
    const result = new Promise<string>((resolve, reject) => { settle = { resolve, reject }; });
    result.catch(() => undefined);
    const session = new GeminiSession(() => this.credentials.take(), this.config, (event) => {
      switch (event.type) {
        case "finalTranscript": settle.resolve(event.text); return;
        case "error": settle.reject(new Error(event.message)); return;
        case "connected":
        case "partialTranscript":
        case "closed":
          return;
        default: {
          const unhandled: never = event;
          throw new Error(`Unhandled transcription event: ${JSON.stringify(unhandled)}`);
        }
      }
    }, { finalTimeoutMs: FINAL_TIMEOUT_MS + pcm.byteLength / PCM_BYTES_PER_MS });

    const onAbort = () => {
      settle.reject(new DOMException("Recovery cancelled.", "AbortError"));
      void session.close();
    };
    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    const streaming = (async () => {
      await session.connect();
      await session.startUtterance();
      for (let offset = 0; offset < pcm.byteLength && !signal.aborted; offset += REPLAY_CHUNK_BYTES) {
        await session.drain(REPLAY_MAX_BUFFERED);
        await session.sendAudio(pcm.slice(offset, offset + REPLAY_CHUNK_BYTES));
      }
      await session.endUtterance();
    })();
    streaming.catch(() => undefined);
    try {
      return await Promise.race([result, streaming.then(() => result)]);
    } finally {
      signal.removeEventListener("abort", onAbort);
      void session.close();
    }
  }
}

interface SessionOptions {
  finalTimeoutMs: number;
}

/** One connection and one explicitly delimited utterance; never reuse a completed session. */
export class GeminiSession implements TranscriptionSession {
  private socket?: WebSocket;
  private phase: "new" | "connecting" | "ready" | "listening" | "finalizing" | "done" | "closed" = "new";
  private timer?: ReturnType<typeof setTimeout>;
  private resolveConnect?: () => void;
  private rejectConnect?: (error: Error) => void;
  private messages = Promise.resolve();
  /** Finalized segments emitted on in-utterance pauses, before Stop. */
  private committed: string[] = [];
  private options: SessionOptions;

  constructor(
    private credential: () => Promise<string>,
    private config: GeminiConfig,
    private emit: (event: TranscriptionEvent) => void,
    options: Partial<SessionOptions> = {},
  ) {
    this.options = { finalTimeoutMs: FINAL_TIMEOUT_MS, ...options };
  }

  connect(): Promise<void> {
    if (this.phase !== "new") return Promise.reject(new Error("Session already used."));
    this.phase = "connecting";
    return new Promise((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
      this.timer = setTimeout(() => this.fail("Transcription connection timed out. Check your connection and try again.", true), CONNECT_TIMEOUT_MS);
      this.credential().then(
        (token) => this.open(token),
        (error: unknown) => {
          if (error instanceof CredentialError) this.fail(error.message, error.retryable);
          else this.fail("Could not get a transcription credential.", true);
        },
      );
    });
  }

  async startUtterance() {
    if (this.phase !== "ready") throw new Error("Transcription is not connected.");
    this.phase = "listening";
    this.send({ realtimeInput: { activityStart: {} } });
  }

  async sendAudio(chunk: ArrayBuffer) {
    if (this.phase !== "listening") throw new Error("Transcription is not listening.");
    if ((this.socket?.bufferedAmount ?? 0) > CONGESTED_BUFFERED) {
      this.fail("The connection cannot keep up with microphone audio.", true);
      throw new Error("Audio stream is congested.");
    }
    this.send({ realtimeInput: { audio: { data: toBase64(chunk), mimeType: "audio/pcm;rate=16000" } } });
  }

  /** Waits until the socket's send buffer is below `maxBuffered` (used when replaying faster than real time). */
  async drain(maxBuffered: number) {
    while (this.phase === "listening" && (this.socket?.bufferedAmount ?? 0) > maxBuffered) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  async endUtterance() {
    if (this.phase !== "listening") throw new Error("Transcription is not listening.");
    this.phase = "finalizing";
    this.timer = setTimeout(() => this.fail("No final transcript arrived.", true), this.options.finalTimeoutMs);
    this.send({ realtimeInput: { activityEnd: {} } });
  }

  async close() {
    if (this.phase === "closed") return;
    this.phase = "closed";
    clearTimeout(this.timer);
    this.rejectConnect?.(new Error("Transcription cancelled."));
    this.resolveConnect = undefined;
    this.rejectConnect = undefined;
    this.socket?.close();
  }

  private open(token: string) {
    if (this.phase !== "connecting") return;
    try {
      // Never display the socket URL: it carries the token.
      const socket = this.socket = new WebSocket(`${ENDPOINT}?access_token=${encodeURIComponent(token)}`);
      socket.onopen = () => {
        if (this.phase === "connecting") {
          try { this.send(setupMessage(this.config)); }
          catch { this.fail("Could not configure the transcription session.", true); }
        }
      };
      socket.onmessage = (event: MessageEvent<unknown>) => {
        this.messages = this.messages.then(async () => {
          if (this.phase === "closed" || this.phase === "done") return;
          const data = event.data instanceof Blob ? await event.data.text() : event.data;
          if (typeof data !== "string") throw new Error("Invalid frame");
          this.receive(JSON.parse(data) as unknown);
        }).catch(() => this.fail("The transcription service sent an unreadable response.", true));
      };
      socket.onerror = () => this.fail("Could not reach transcription. Check your connection.", true);
      socket.onclose = (event: CloseEvent) => {
        if (this.phase === "closed" || this.phase === "done") return;
        const reason = event.reason ? ` (${event.code}: ${redact(event.reason)})` : "";
        this.fail(`Transcription disconnected before completion${reason}.`, !REFUSED_CLOSE_CODES.has(event.code));
      };
    } catch { this.fail("Could not open the transcription connection.", true); }
  }

  private send(message: unknown) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error("Transcription connection is not open.");
    this.socket.send(JSON.stringify(message));
  }

  private joined(next?: string): string {
    return [...this.committed, next ?? ""].map((part) => part.trim()).filter(Boolean).join(" ");
  }

  private receive(raw: unknown) {
    if (this.phase === "closed" || this.phase === "done") return;
    const message = record(raw);
    if (message.error) { this.fail("Transcription refused the session. Try signing in again.", false); return; }
    if (message.goAway) { this.fail("The transcription session expired.", true); return; }
    if (message.setupComplete && this.phase === "connecting") {
      clearTimeout(this.timer);
      this.phase = "ready";
      this.resolveConnect?.();
      this.resolveConnect = undefined;
      this.rejectConnect = undefined;
      this.emit({ type: "connected" });
    }
    if (this.phase !== "listening" && this.phase !== "finalizing") return;
    const content = record(message.serverContent);
    const interim = record(content.interimInputTranscription).text;
    if (typeof interim === "string") this.emit({ type: "partialTranscript", text: this.joined(interim) });
    const final = record(content.inputTranscription).text;
    if (typeof final !== "string") return;
    if (this.phase === "listening") {
      this.committed.push(final);
      this.emit({ type: "partialTranscript", text: this.joined() });
      return;
    }
    // The first final after activityEnd closes the utterance; later duplicates are dropped by phase "done".
    this.phase = "done";
    clearTimeout(this.timer);
    this.emit({ type: "finalTranscript", text: this.joined(final) });
  }

  private fail(message: string, retryable: boolean) {
    if (this.phase === "closed" || this.phase === "done") return;
    this.rejectConnect?.(new Error(message));
    this.rejectConnect = undefined;
    void this.close();
    this.emit({ type: "error", message, retryable });
  }
}
