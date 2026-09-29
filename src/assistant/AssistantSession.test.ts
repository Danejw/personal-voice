import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantSession } from "@/assistant/AssistantSession";
import type { AssistantEvent } from "@/assistant/events";
import { assistantAudioChunk, assistantSetupMessage, assistantUserTurn } from "@/assistant/protocol";
import { CredentialError } from "@/voice/provider/gemini/GeminiTokenSource";

class FakeSocket {
  static readonly OPEN = 1;
  static last?: FakeSocket;
  readyState = 0;
  sent: unknown[] = [];
  url = "";
  onopen?: () => void;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  onclose?: (event: { code: number; reason: string }) => void;

  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }

  send(data: string) { this.sent.push(JSON.parse(data) as unknown); }
  close() { this.readyState = 3; }
  open() { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
  serverSends(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

const TOKEN = "auth_tokens/assistant-token";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function b64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes));
}

beforeEach(() => { vi.stubGlobal("WebSocket", FakeSocket); });
afterEach(() => { vi.unstubAllGlobals(); FakeSocket.last = undefined; });

async function readySession() {
  const events: AssistantEvent[] = [];
  const session = new AssistantSession(async () => TOKEN, (event) => events.push(event));
  const connected = session.connect();
  await flush();
  const socket = FakeSocket.last as FakeSocket;
  socket.open();
  socket.serverSends({ setupComplete: {} });
  await connected;
  return { session, socket, events };
}

describe("AssistantSession", () => {
  it("connects to constrained v1alpha and sends the audio setup", async () => {
    const { socket, events } = await readySession();
    expect(socket.url).toBe(
      `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(TOKEN)}`,
    );
    expect(socket.sent[0]).toEqual(assistantSetupMessage());
    expect(JSON.stringify(socket.sent)).not.toContain("assistant-token");
    expect(events[0]).toEqual({ type: "ready" });
  });

  it("forwards microphone PCM at 16 kHz without closing the socket", async () => {
    const { session, socket } = await readySession();
    session.sendAudio(Uint8Array.of(1, 2, 3, 4).buffer);
    session.sendAudio(Uint8Array.of(5, 6).buffer);
    expect(socket.sent.slice(1)).toEqual([
      assistantAudioChunk(btoa(String.fromCharCode(1, 2, 3, 4))),
      assistantAudioChunk(btoa(String.fromCharCode(5, 6))),
    ]);
    expect(socket.sent[1]).toMatchObject({ realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000" } } });
  });

  it("keeps the socket for a second typed turn and reads the spoken transcript", async () => {
    const { session, socket, events } = await readySession();
    session.sendTurn("Reply with exactly: Assistant online.");
    socket.serverSends({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: b64([0, 0]) } }] },
        outputTranscription: { text: "Assistant online." },
        turnComplete: true,
      },
    });
    await flush();
    session.sendTurn("What exact phrase did I ask you to say?");
    await flush();

    expect(socket.sent.slice(1)).toEqual([
      assistantUserTurn("Reply with exactly: Assistant online."),
      assistantUserTurn("What exact phrase did I ask you to say?"),
    ]);
    expect(events.slice(1).map((event) => event.type)).toEqual(["audio", "outputTranscription", "turnComplete"]);
    const transcript = events.find((event) => event.type === "outputTranscription");
    expect(transcript).toEqual({ type: "outputTranscription", text: "Assistant online." });
  });

  it("joins a split PCM sample and ignores messages after close", async () => {
    const { session, socket, events } = await readySession();
    socket.serverSends({ serverContent: { modelTurn: { parts: [{ inlineData: { data: b64([1]) } }] } } });
    socket.serverSends({ serverContent: { modelTurn: { parts: [{ inlineData: { data: b64([2]) } }] } } });
    await flush();
    session.close();
    socket.serverSends({ serverContent: { outputTranscription: { text: "too late" }, turnComplete: true } });
    await flush();

    const audio = events.filter((event) => event.type === "audio");
    expect(audio).toHaveLength(1);
    expect(events.some((event) => event.type === "outputTranscription")).toBe(false);
  });

  it("redacts a refused close and does not retry it", async () => {
    const { socket, events } = await readySession();
    const fakeKey = "AIza" + "SyA1234567890abcdefghijklmnopqrstu";
    socket.onclose?.({ code: 1008, reason: `token auth_tokens/abc123 invalid, key ${fakeKey}` });
    const error = events.at(-1);
    expect(error).toMatchObject({ type: "error", retryable: false });
    expect(JSON.stringify(error)).not.toContain("abc123");
    expect(JSON.stringify(error)).not.toContain("AIza");
  });

  it("turns a credential failure into one typed error", async () => {
    const events: AssistantEvent[] = [];
    const session = new AssistantSession(
      () => Promise.reject(new CredentialError("Sign in to use Assistant.", false)),
      (event) => events.push(event),
    );
    await expect(session.connect()).rejects.toThrow("Sign in to use Assistant.");
    expect(events).toEqual([{ type: "error", message: "Sign in to use Assistant.", retryable: false }]);
  });

  it("sends a resumption handle and context-window compression in setup", async () => {
    const events: AssistantEvent[] = [];
    const session = new AssistantSession(async () => TOKEN, (event) => events.push(event), "resume-handle");
    const connected = session.connect();
    await flush();
    const socket = FakeSocket.last as FakeSocket;
    socket.open();
    expect(socket.sent[0]).toEqual(assistantSetupMessage("resume-handle"));
    socket.serverSends({ sessionResumptionUpdate: { resumable: true, newHandle: "newer-handle" } });
    socket.serverSends({ goAway: { timeLeft: "10s" } });
    socket.serverSends({ setupComplete: {} });
    await flush();
    await connected;
    expect(events.map((event) => event.type)).toEqual(["resumption", "goAway", "ready"]);
    const resumed = events.find((event) => event.type === "resumption");
    expect(resumed).toEqual({ type: "resumption", handle: "newer-handle" });
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("forwards a tool call and writes the function response with the same id", async () => {
    const { session, socket, events } = await readySession();
    socket.serverSends({
      toolCall: { functionCalls: [{ id: "call-9", name: "copy_text", args: { text: "hi" } }] },
    });
    await flush();
    expect(events.at(-1)).toMatchObject({
      type: "toolCalls",
      calls: [{ id: "call-9", name: "copy_text" }],
    });
    expect(events.some((event) => event.type === "error")).toBe(false);
    session.sendToolResponse({
      toolResponse: { functionResponses: [{ id: "call-9", name: "copy_text", response: { result: "Copied to the clipboard." } }] },
    });
    expect(socket.sent.at(-1)).toMatchObject({
      toolResponse: { functionResponses: [{ id: "call-9", name: "copy_text" }] },
    });
  });

  it("reports a recoverable drop without treating a refused close as resumable", async () => {
    const { socket, events } = await readySession();
    socket.onclose?.({ code: 1006, reason: "" });
    expect(events.at(-1)).toEqual({ type: "disconnected" });
  });
});
