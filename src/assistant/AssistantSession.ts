import type { AssistantEvent } from "@/assistant/events";
import { ASSISTANT_SEARCH_UNAVAILABLE } from "@/assistant/grounding";
import { CredentialError } from "@/voice/provider/gemini/GeminiTokenSource";
import {
  ASSISTANT_ENDPOINT,
  assistantAudioChunk,
  assistantContextNote,
  assistantHistorySeed,
  assistantSetupMessage,
  assistantSnapshotFrame,
  assistantUserTurn,
  decodeBase64,
  encodeBase64,
  parseAssistantServerMessage,
  redactSecrets,
  takePcm16,
} from "@/assistant/protocol";

const CONNECT_TIMEOUT_MS = 15_000;
/** Close codes that mean the request itself was refused. */
const REFUSED_CLOSE_CODES = new Set([1007, 1008]);

/** Supplies one fresh, single-use Live token for this Assistant session. */
export interface AssistantCredentials {
  take(): Promise<string>;
}

/**
 * One Gemini 3.8 Live socket. Typed turns reuse it until `close`.
 * Messages that arrive after close are dropped.
 */
export class AssistantSession {
  private socket?: WebSocket;
  private phase: "new" | "connecting" | "ready" | "closed" = "new";
  private timer?: ReturnType<typeof setTimeout>;
  private resolveConnect?: () => void;
  private rejectConnect?: (error: Error) => void;
  private messages = Promise.resolve();
  private carry = new Uint8Array(0);
  /** Search is on for the first setup. A quota close retries once without it. */
  private search = true;
  private droppedSearch = false;
  private attempt = 0;

  constructor(
    private credential: () => Promise<string>,
    private emit: (event: AssistantEvent) => void,
    private resumeHandle: string | null = null,
  ) {}

  connect(): Promise<void> {
    if (this.phase !== "new") return Promise.reject(new Error("Session already used."));
    this.phase = "connecting";
    return new Promise((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
      this.armConnectTimer();
      this.credential().then(
        (token) => this.open(token),
        (error: unknown) => {
          if (error instanceof CredentialError) this.fail(error.message, error.retryable);
          else this.fail("Couldn't start Assistant. Check your connection and try again.", true);
        },
      );
    });
  }

  /** Sends one microphone chunk. Automatic VAD decides when the user turn ends. */
  sendAudio(pcm: ArrayBuffer): void {
    if (this.phase !== "ready" || pcm.byteLength === 0) throw new Error("Assistant is not ready.");
    this.send(assistantAudioChunk(encodeBase64(pcm)));
  }

  /** Seeds a new session with earlier turns. Does not ask for a reply. */
  sendHistory(turns: { role: "user" | "model"; text: string }[]): void {
    if (this.phase !== "ready") throw new Error("Assistant is not ready.");
    this.send(assistantHistorySeed(turns));
  }

  /** Sends one completed typed turn. A selection, when present, is a separate part. */
  sendTurn(text: string, selectionText?: string | null, accountText?: string | null, personalText?: string | null): void {
    if (this.phase !== "ready") throw new Error("Assistant is not ready.");
    this.send(assistantUserTurn(text, selectionText, accountText, personalText));
  }

  /** Sends one still JPEG. This is not a repeating video stream. */
  sendVideo(jpegBase64: string): void {
    if (this.phase !== "ready") throw new Error("Assistant is not ready.");
    this.send(assistantSnapshotFrame(jpegBase64));
  }

  /** Adds attached or removed selection context without starting a reply. */
  sendNote(text: string): void {
    if (this.phase !== "ready") throw new Error("Assistant is not ready.");
    this.send(assistantContextNote(text));
  }

  /** Sends function responses. The caller supplies the ids from the tool call. */
  sendToolResponse(message: unknown): void {
    if (this.phase !== "ready") throw new Error("Assistant is not ready.");
    this.send(message);
  }

  close(): void {
    if (this.phase === "closed") return;
    this.phase = "closed";
    this.carry = new Uint8Array(0);
    clearTimeout(this.timer);
    this.rejectConnect?.(new Error("Assistant cancelled."));
    this.resolveConnect = undefined;
    this.rejectConnect = undefined;
    this.socket?.close();
  }

  private open(token: string) {
    if (this.phase !== "connecting") return;
    const attempt = ++this.attempt;
    try {
      const socket = this.socket = new WebSocket(`${ASSISTANT_ENDPOINT}?access_token=${encodeURIComponent(token)}`);
      socket.onopen = () => {
        if (attempt !== this.attempt || this.phase !== "connecting") return;
        try { this.send(assistantSetupMessage(this.resumeHandle, { search: this.search })); }
        catch { this.fail("Could not configure the Assistant session.", true); }
      };
      socket.onmessage = (event: MessageEvent<unknown>) => {
        this.messages = this.messages.then(async () => {
          if (attempt !== this.attempt || this.phase === "closed") return;
          const data = event.data instanceof Blob ? await event.data.text() : event.data;
          if (typeof data !== "string") throw new Error("Invalid frame");
          this.receive(JSON.parse(data) as unknown);
        }).catch(() => this.fail("Assistant sent an unreadable response.", true));
      };
      socket.onerror = () => {
        if (attempt !== this.attempt || this.phase !== "ready") return;
        this.signalDisconnect();
      };
      socket.onclose = (event: CloseEvent) => {
        if (attempt !== this.attempt || this.phase === "closed") return;
        if (this.phase !== "ready" && this.search && isSearchQuota(event.reason)) {
          this.search = false;
          this.droppedSearch = true;
          this.armConnectTimer();
          this.credential().then(
            (next) => { if (attempt === this.attempt) this.open(next); },
            (error: unknown) => {
              if (error instanceof CredentialError) this.fail(error.message, error.retryable);
              else this.fail("Couldn't start Assistant. Check your connection and try again.", true);
            },
          );
          return;
        }
        const detail = closeDetail(event.code, event.reason);
        const refused = REFUSED_CLOSE_CODES.has(event.code);
        if (refused) {
          this.fail(`Assistant disconnected (${detail}).`, false);
          return;
        }
        if (this.phase === "ready") this.signalDisconnect();
        else this.fail(`Assistant disconnected (${detail}). Try again.`, true);
      };
    } catch {
      this.fail("Could not open the Assistant connection.", true);
    }
  }

  private send(message: unknown) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error("Assistant connection is not open.");
    this.socket.send(JSON.stringify(message));
  }

  private receive(raw: unknown) {
    if (this.phase === "closed") return;
    let events;
    try {
      events = parseAssistantServerMessage(raw);
    } catch {
      this.fail("Assistant sent an unreadable response.", true);
      return;
    }
    for (const event of events) {
      if (!this.isOpen()) return;
      switch (event.type) {
        case "setupComplete":
          if (this.phase !== "connecting") break;
          clearTimeout(this.timer);
          this.phase = "ready";
          this.resolveConnect?.();
          this.resolveConnect = undefined;
          this.rejectConnect = undefined;
          this.emit({ type: "ready" });
          if (this.droppedSearch) this.emit({ type: "notice", message: ASSISTANT_SEARCH_UNAVAILABLE });
          break;
        case "audio":
          this.emitAudio(event.base64);
          break;
        case "inputTranscription":
          this.emit({ type: "inputTranscription", text: event.text, partial: event.partial });
          break;
        case "outputTranscription":
          this.emit({ type: "outputTranscription", text: event.text });
          break;
        case "turnComplete":
          this.emit({ type: "turnComplete" });
          break;
        case "interrupted":
          this.emit({ type: "interrupted" });
          break;
        case "goAway":
          this.emit({ type: "goAway" });
          break;
        case "resumption":
          this.emit({ type: "resumption", handle: event.handle });
          break;
        case "toolCalls":
          this.emit({ type: "toolCalls", calls: event.calls });
          break;
        case "grounding":
          this.emit({ type: "grounding", sources: event.sources });
          break;
        case "refused":
          this.fail(redactSecrets(event.message), false);
          return;
        default: {
          const unhandled: never = event;
          throw new Error(`Unhandled assistant wire event: ${JSON.stringify(unhandled)}`);
        }
      }
    }
  }

  private emitAudio(base64: string) {
    let decoded: Uint8Array<ArrayBuffer>;
    try {
      decoded = decodeBase64(base64);
    } catch {
      this.fail("Assistant sent audio that could not be played.", true);
      return;
    }
    const taken = takePcm16(decoded, this.carry);
    this.carry = taken.carry;
    if (!taken.pcm.byteLength) return;
    const pcm = new ArrayBuffer(taken.pcm.byteLength);
    new Uint8Array(pcm).set(taken.pcm);
    this.emit({ type: "audio", pcm });
  }

  private isOpen(): boolean {
    return this.phase !== "closed";
  }

  /** A live socket dropped. The controller decides whether it can be resumed. */
  private signalDisconnect() {
    if (this.phase === "closed") return;
    const reject = this.rejectConnect;
    this.rejectConnect = undefined;
    this.resolveConnect = undefined;
    this.phase = "closed";
    clearTimeout(this.timer);
    this.socket?.close();
    reject?.(new Error("Assistant disconnected."));
    this.emit({ type: "disconnected" });
  }

  private fail(message: string, retryable: boolean) {
    if (this.phase === "closed") return;
    const reject = this.rejectConnect;
    this.rejectConnect = undefined;
    this.resolveConnect = undefined;
    reject?.(new Error(message));
    this.phase = "closed";
    clearTimeout(this.timer);
    this.socket?.close();
    this.emit({ type: "error", message, retryable });
  }

  private armConnectTimer() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fail("Assistant connection timed out. Check your connection and try again.", true), CONNECT_TIMEOUT_MS);
  }
}

function isSearchQuota(reason: string): boolean {
  return /quota/i.test(reason);
}

function closeDetail(code: number, reason: string): string {
  const clean = redactSecrets(reason).replace(/\s+/g, " ").trim();
  if (!clean) return `code ${code}`;
  return `${code}: ${clean.length > 160 ? `${clean.slice(0, 160)}…` : clean}`;
}
