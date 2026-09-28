import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptionEvent } from "../VoiceProvider";
import { GEMINI_MODEL, GeminiProvider, GeminiSession, setupMessage, toBase64 } from "./GeminiProvider";
import { CredentialError } from "./GeminiTokenSource";

class FakeSocket {
  static readonly OPEN = 1;
  static last?: FakeSocket;
  static opened: FakeSocket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  sent: Record<string, unknown>[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  onclose?: (event: { code: number; reason: string }) => void;

  constructor(readonly url: string) { FakeSocket.last = this; FakeSocket.opened.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data) as Record<string, unknown>); }
  close() { this.readyState = 3; }
  open() { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
  serverSends(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

const TOKEN = "auth_tokens/test-token";
const config = { smart: true, languageCodes: [], vocabulary: [] };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const credential = async () => TOKEN;

async function listeningSession() {
  const events: TranscriptionEvent[] = [];
  const session = new GeminiSession(credential, config, (event) => events.push(event));
  const connected = session.connect();
  await flush();
  const socket = FakeSocket.last as FakeSocket;
  socket.open();
  socket.serverSends({ setupComplete: {} });
  await connected;
  await session.startUtterance();
  return { session, socket, events };
}

beforeEach(() => { vi.stubGlobal("WebSocket", FakeSocket); });
afterEach(() => { vi.unstubAllGlobals(); FakeSocket.last = undefined; FakeSocket.opened = []; });

describe("GeminiSession", () => {
  it("configures the dedicated transcription model for push-to-talk", () => {
    const { setup } = setupMessage({ smart: true, languageCodes: ["en-US"], vocabulary: ["Supabase"] });
    expect(setup.model).toBe(`models/${GEMINI_MODEL}`);
    expect(setup.inputAudioTranscription).toEqual({ mode: "SMART", languageCodes: ["en-US"], customVocabulary: ["Supabase"] });
    expect(setup.realtimeInputConfig).toEqual({ automaticActivityDetection: { disabled: true } });
    expect(setupMessage({ ...config, smart: false }).setup.inputAudioTranscription).toEqual({ mode: "VERBATIM", languageCodes: [] });
  });

  it("connects to the constrained v1alpha endpoint with the ephemeral token only in the URL", async () => {
    const { socket } = await listeningSession();
    expect(socket.url).toBe(
      `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(TOKEN)}`,
    );
    expect(JSON.stringify(socket.sent)).not.toContain("test-token");
  });

  it("streams base64 PCM between activity markers and emits partials then one final", async () => {
    const { session, socket, events } = await listeningSession();
    await session.sendAudio(new Uint8Array([1, 2, 3]).buffer);
    socket.serverSends({ serverContent: { interimInputTranscription: { text: "hello wor" } } });
    await session.endUtterance();
    socket.serverSends({ serverContent: { inputTranscription: { text: "Hello world." } } });
    socket.serverSends({ serverContent: { inputTranscription: { text: "Hello world." } } });
    await flush();

    expect(socket.sent.slice(1)).toEqual([
      { realtimeInput: { activityStart: {} } },
      { realtimeInput: { audio: { data: "AQID", mimeType: "audio/pcm;rate=16000" } } },
      { realtimeInput: { activityEnd: {} } },
    ]);
    expect(events).toEqual([
      { type: "connected" },
      { type: "partialTranscript", text: "hello wor" },
      { type: "finalTranscript", text: "Hello world." },
    ]);
  });

  it("joins segments finalized on pauses before Stop into one final transcript", async () => {
    const { session, socket, events } = await listeningSession();
    socket.serverSends({ serverContent: { inputTranscription: { text: "First part." } } });
    socket.serverSends({ serverContent: { interimInputTranscription: { text: "second" } } });
    await flush();
    await session.endUtterance();
    socket.serverSends({ serverContent: { inputTranscription: { text: "Second part." } } });
    await flush();

    expect(events.slice(1)).toEqual([
      { type: "partialTranscript", text: "First part." },
      { type: "partialTranscript", text: "First part. second" },
      { type: "finalTranscript", text: "First part. Second part." },
    ]);
  });

  it("reports a policy close as a single redacted, non-retryable error", async () => {
    const { socket, events } = await listeningSession();
    // A fake key, split so secret scanners don't flag the repo.
    const fakeKey = "AIza" + "SyA1234567890abcdefghijklmnopqrstu";
    socket.onclose?.({ code: 1008, reason: `token auth_tokens/abc123 invalid, key ${fakeKey}` });
    socket.onerror?.();
    const errors = events.filter((event) => event.type === "error");
    expect(errors).toEqual([expect.objectContaining({ retryable: false })]);
    expect(JSON.stringify(errors)).not.toContain("AIza");
    expect(JSON.stringify(errors)).not.toContain("abc123");
    expect(JSON.stringify(errors)).toContain("1008");
  });

  it("marks network drops and session expiry as retryable", async () => {
    const dropped = await listeningSession();
    dropped.socket.onclose?.({ code: 1006, reason: "" });
    expect(dropped.events.at(-1)).toMatchObject({ type: "error", retryable: true });

    const expired = await listeningSession();
    expired.socket.serverSends({ goAway: { timeLeft: "1s" } });
    await flush();
    expect(expired.events.at(-1)).toMatchObject({ type: "error", retryable: true });
  });

  it("emits a retryable error when no final arrives after activity end", async () => {
    const { session, events } = await listeningSession();
    vi.useFakeTimers();
    try {
      await session.endUtterance();
      vi.advanceTimersByTime(10_000);
    } finally { vi.useRealTimers(); }
    expect(events.at(-1)).toMatchObject({ type: "error", retryable: true });
  });

  it("rejects connect and emits a non-retryable error when the server refuses setup", async () => {
    const events: TranscriptionEvent[] = [];
    const session = new GeminiSession(credential, config, (event) => events.push(event));
    const connected = session.connect();
    await flush();
    const socket = FakeSocket.last as FakeSocket;
    socket.open();
    socket.serverSends({ error: { message: "model not found" } });
    await expect(connected).rejects.toThrow();
    expect(events).toEqual([{ type: "error", message: expect.any(String) as string, retryable: false }]);
  });

  it("passes credential failures through with their retryability and never opens a socket", async () => {
    const events: TranscriptionEvent[] = [];
    const session = new GeminiSession(async () => { throw new CredentialError("Sign in to dictate.", false); }, config, (event) => events.push(event));
    await expect(session.connect()).rejects.toThrow("Sign in to dictate.");
    expect(events).toEqual([{ type: "error", message: "Sign in to dictate.", retryable: false }]);
    expect(FakeSocket.opened).toHaveLength(0);
  });

  it("does not open a socket if closed while the token is still being fetched", async () => {
    let release!: (token: string) => void;
    const session = new GeminiSession(() => new Promise((resolve) => { release = resolve; }), config, () => undefined);
    const connected = session.connect();
    await session.close();
    release(TOKEN);
    await expect(connected).rejects.toThrow("cancelled");
    await flush();
    expect(FakeSocket.opened).toHaveLength(0);
  });
});

describe("toBase64", () => {
  it("encodes buffers larger than one conversion slice", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => i % 251);
    const decoded = Uint8Array.from(atob(toBase64(bytes.buffer)), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });
});

describe("GeminiProvider.transcribeRecording", () => {
  const tokens = () => {
    const taken: string[] = [];
    return { taken, take: async () => { taken.push("token"); return `auth_tokens/${taken.length}`; } };
  };

  async function replayUntilEnd(provider: GeminiProvider, pcm: ArrayBuffer, signal = new AbortController().signal) {
    const result = provider.transcribeRecording(pcm, signal);
    await flush();
    const socket = FakeSocket.last as FakeSocket;
    socket.open();
    socket.serverSends({ setupComplete: {} });
    await flush();
    await flush();
    return { result, socket };
  }

  it("replays the buffer into a fresh Live session with its own token and resolves the final", async () => {
    const credentials = tokens();
    const provider = new GeminiProvider(credentials);
    const pcm = new Uint8Array(16_000 * 2 + 10).fill(7).buffer;
    const { result, socket } = await replayUntilEnd(provider, pcm);

    const kinds = socket.sent.slice(1).map((message) => Object.keys(message.realtimeInput as object)[0]);
    expect(kinds).toEqual(["activityStart", "audio", "audio", "audio", "activityEnd"]);
    socket.serverSends({ serverContent: { inputTranscription: { text: "Recovered." } } });
    await expect(result).resolves.toBe("Recovered.");
    expect(credentials.taken).toHaveLength(1);
    expect(socket.url).toContain("access_token=auth_tokens%2F1");
  });

  it("rejects with the provider message when the replay session fails", async () => {
    const provider = new GeminiProvider(tokens());
    const { result, socket } = await replayUntilEnd(provider, new Uint8Array(100).buffer);
    socket.onclose?.({ code: 1011, reason: "" });
    await expect(result).rejects.toThrow("Transcription disconnected");
  });

  it("aborts cleanly and closes the replay socket", async () => {
    const provider = new GeminiProvider(tokens());
    const abort = new AbortController();
    const { result, socket } = await replayUntilEnd(provider, new Uint8Array(100).buffer, abort.signal);
    abort.abort();
    await expect(result).rejects.toThrow("Recovery cancelled.");
    expect(socket.readyState).toBe(3);
  });

  it("fails without opening a socket when no credential is available", async () => {
    const provider = new GeminiProvider({ take: async () => { throw new CredentialError("Sign in to dictate.", false); } });
    await expect(provider.transcribeRecording(new Uint8Array(10).buffer, new AbortController().signal)).rejects.toThrow("Sign in to dictate.");
    expect(FakeSocket.opened).toHaveLength(0);
  });
});
