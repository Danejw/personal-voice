import { describe, expect, it } from "vitest";
import type { AudioCapture } from "@/voice/audio/AudioCapture";
import type { TranscriptionEvent, TranscriptionSession, VoiceProvider } from "@/voice/provider/VoiceProvider";
import { DictationController, NO_SPEECH } from "@/voice/session/DictationController";
import type { DictationOptions, DictationSnapshot } from "@/voice/session/DictationController";
import { formatTimings } from "@/voice/session/timings";
import type { UtteranceTimings } from "@/voice/session/timings";

class FakeCapture implements AudioCapture {
  onChunk?: (chunk: ArrayBuffer) => void;
  onError?: (message: string) => void;
  stops: boolean[] = [];
  startError?: Error;
  async start(onChunk: (chunk: ArrayBuffer) => void, onError: (message: string) => void) {
    if (this.startError) throw this.startError;
    this.onChunk = onChunk;
    this.onError = onError;
  }
  async stop(flush: boolean) {
    this.stops.push(flush);
    if (flush) this.onChunk?.(chunk(9));
  }
}

class FakeSession implements TranscriptionSession {
  calls: string[] = [];
  resolveConnect?: () => void;
  rejectConnect?: (error: Error) => void;
  constructor(readonly emit: (event: TranscriptionEvent) => void) {}
  connect() {
    this.calls.push("connect");
    return new Promise<void>((resolve, reject) => { this.resolveConnect = resolve; this.rejectConnect = reject; });
  }
  async startUtterance() { this.calls.push("start"); }
  async sendAudio(data: ArrayBuffer) { this.calls.push(`audio:${new Uint8Array(data)[0]}`); }
  async endUtterance() { this.calls.push("end"); }
  async close() { this.calls.push("close"); }
  /** What a real session does on a network drop: emit, then reject a pending connect. */
  drop(retryable = true) {
    this.emit({ type: "error", message: "Transcription disconnected.", retryable });
    this.rejectConnect?.(new Error("Transcription disconnected."));
  }
}

interface Recovery {
  audio: number[];
  signal: AbortSignal;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

const chunk = (value: number) => new Uint8Array([value]).buffer;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function setup(options: { limits?: DictationOptions; recoverable?: boolean } = {}) {
  const capture = new FakeCapture();
  const snapshots: DictationSnapshot[] = [];
  const inserted: string[] = [];
  const insert = { error: undefined as Error | undefined };
  const controller = new DictationController(
    () => capture,
    (snapshot) => snapshots.push(snapshot),
    {
      async deliver(text) {
        if (insert.error) throw insert.error;
        inserted.push(text);
      },
    },
    { minAudioBytes: 0, ...options.limits },
  );
  let session: FakeSession | undefined;
  const recoveries: Recovery[] = [];
  const provider: VoiceProvider = { createSession: (emit) => (session = new FakeSession(emit)) };
  if (options.recoverable ?? true) {
    provider.transcribeRecording = (pcm, signal) => new Promise<string>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      recoveries.push({ audio: [...new Uint8Array(pcm)], signal, resolve, reject });
    });
  }
  const current = () => session as FakeSession;
  async function listen() {
    const started = controller.start(provider);
    await flush();
    current().resolveConnect?.();
    await started;
    await flush();
  }
  return { capture, controller, provider, snapshots, current, listen, inserted, insert, recoveries };
}

describe("DictationController", () => {
  it("runs Record → partial → Stop → one final transcript → IDLE", async () => {
    const { capture, controller, current, listen, snapshots, inserted, recoveries } = setup();
    await listen();
    expect(controller.current.state).toBe("LISTENING");

    capture.onChunk?.(chunk(1));
    current().emit({ type: "partialTranscript", text: "hel" });
    expect(controller.current.partial).toBe("hel");

    await controller.stop();
    expect(controller.current.state).toBe("FINALIZING");
    current().emit({ type: "finalTranscript", text: " Hello. " });
    await flush();

    expect(controller.current).toEqual({ state: "IDLE", partial: "", transcript: "Hello.", error: null, utterance: 1 });
    expect(current().calls).toEqual(["connect", "start", "audio:1", "audio:9", "end", "close"]);
    expect(capture.stops).toEqual([true, false]);
    expect(snapshots.map((s) => s.state)).toContain("INSERTING");
    expect(inserted).toEqual(["Hello."]);
    expect(recoveries).toHaveLength(0);
  });

  it("inserts once even when the provider repeats the final", async () => {
    const { controller, current, listen, inserted } = setup();
    await listen();
    await controller.stop();
    current().emit({ type: "finalTranscript", text: "Once." });
    current().emit({ type: "finalTranscript", text: "Once." });
    await flush();
    expect(inserted).toEqual(["Once."]);
  });

  it("reports an empty transcript as no speech and inserts nothing", async () => {
    const { controller, current, listen, inserted } = setup();
    await listen();
    await controller.stop();
    current().emit({ type: "finalTranscript", text: "   " });
    await flush();
    expect(controller.current).toMatchObject({ state: "ERROR", error: NO_SPEECH });
    expect(current().calls.at(-1)).toBe("close");
    expect(inserted).toEqual([]);
  });

  it("keeps the transcript visible when insertion fails, and the next utterance still works", async () => {
    const { controller, current, listen, insert, inserted, provider } = setup();
    insert.error = new Error("Windows blocked the paste keystroke.");
    await listen();
    await controller.stop();
    current().emit({ type: "finalTranscript", text: "Keep me." });
    await flush();
    expect(controller.current).toMatchObject({ state: "ERROR", transcript: "Keep me.", error: "Windows blocked the paste keystroke." });

    insert.error = undefined;
    const pressed = controller.press(provider);
    await flush();
    current().resolveConnect?.();
    await pressed;
    await flush();
    await controller.stop();
    current().emit({ type: "finalTranscript", text: "Next." });
    await flush();
    expect(inserted).toEqual(["Next."]);
  });

  it("cancel abandons the utterance and a late final from it never inserts", async () => {
    const { controller, current, listen, inserted } = setup();
    await listen();
    await controller.stop();
    const cancelled = current();
    await controller.cancel();
    expect(controller.current.state).toBe("IDLE");
    expect(cancelled.calls.at(-1)).toBe("close");

    cancelled.emit({ type: "finalTranscript", text: "Stale." });
    await flush();
    expect(inserted).toEqual([]);
    expect(controller.current.transcript).toBe("");
  });

  it("does not let a stale session's final insert into the next utterance", async () => {
    const { controller, current, listen, inserted } = setup();
    await listen();
    const first = current();
    await controller.cancel();
    await listen();
    await controller.stop();
    first.emit({ type: "finalTranscript", text: "Old." });
    current().emit({ type: "finalTranscript", text: "New." });
    await flush();
    expect(inserted).toEqual(["New."]);
  });

  it("press starts a fresh utterance after an error", async () => {
    const { controller, current, listen, provider } = setup();
    await listen();
    current().drop(false);
    await flush();
    expect(controller.current.state).toBe("ERROR");
    const pressed = controller.press(provider);
    await flush();
    current().resolveConnect?.();
    await pressed;
    await flush();
    expect(controller.current).toMatchObject({ state: "LISTENING", error: null });
  });

  it("ignores duplicate and late final events", async () => {
    const { controller, current, listen, snapshots } = setup();
    await listen();
    await controller.stop();
    const session = current();
    session.emit({ type: "finalTranscript", text: "Once." });
    session.emit({ type: "finalTranscript", text: "Once." });
    session.emit({ type: "partialTranscript", text: "late" });
    expect(controller.current.transcript).toBe("Once.");
    expect(controller.current.partial).toBe("");
    expect(snapshots.filter((s) => s.state === "INSERTING")).toHaveLength(1);
  });

  it("ignores a final that arrives before Stop", async () => {
    const { controller, current, listen } = setup();
    await listen();
    current().emit({ type: "finalTranscript", text: "Too early." });
    expect(controller.current).toMatchObject({ state: "LISTENING", transcript: "" });
  });

  it("buffers audio captured while connecting and sends it after activity start", async () => {
    const { capture, controller, provider, current } = setup();
    const started = controller.start(provider);
    await flush();
    capture.onChunk?.(chunk(1));
    capture.onChunk?.(chunk(2));
    expect(current().calls).toEqual(["connect"]);
    current().resolveConnect?.();
    await started;
    await flush();
    expect(current().calls).toEqual(["connect", "start", "audio:1", "audio:2"]);
  });

  it("finalizes immediately on a release while still connecting, then ends once connected", async () => {
    const { controller, provider, current } = setup();
    const started = controller.start(provider);
    await flush();
    await controller.stop();
    expect(controller.current.state).toBe("FINALIZING");
    current().resolveConnect?.();
    await started;
    await flush();
    expect(current().calls).toEqual(["connect", "start", "audio:9", "end"]);
  });

  it("moves non-retryable provider errors into ERROR and recovers on reset", async () => {
    const { capture, controller, current, listen, provider, recoveries } = setup();
    await listen();
    current().drop(false);
    await flush();
    expect(controller.current).toMatchObject({ state: "ERROR", error: "Transcription disconnected." });
    expect(current().calls.at(-1)).toBe("close");
    expect(capture.stops).toEqual([false]);
    expect(recoveries).toHaveLength(0);

    await controller.start(provider);
    expect(controller.current.state).toBe("ERROR");
    controller.reset();
    expect(controller.current).toMatchObject({ state: "IDLE", error: null });
  });

  it("reports microphone failures without leaving the session open", async () => {
    const { capture, controller, provider, current } = setup();
    capture.startError = new Error("Microphone permission was denied.");
    await controller.start(provider);
    expect(controller.current).toMatchObject({ state: "ERROR", error: "Microphone permission was denied." });
    expect(current().calls).toEqual(["connect", "close"]);
  });

  it("fails without recovery when the provider has no fallback path", async () => {
    const { controller, current, listen } = setup({ recoverable: false });
    await listen();
    current().drop();
    await flush();
    expect(controller.current).toMatchObject({ state: "ERROR", error: "Transcription disconnected." });
  });
});

describe("DictationController recovery", () => {
  it("keeps recording through a mid-utterance drop and recovers the full buffer once", async () => {
    const { capture, controller, current, listen, inserted, recoveries } = setup();
    await listen();
    capture.onChunk?.(chunk(1));
    const dropped = current();
    dropped.drop();
    await flush();
    expect(controller.current.state).toBe("LISTENING");
    capture.onChunk?.(chunk(2));

    await controller.stop();
    await flush();
    expect(recoveries).toHaveLength(1);
    expect(recoveries[0]?.audio).toEqual([1, 2, 9]);

    dropped.emit({ type: "finalTranscript", text: "Stale live." });
    recoveries[0]?.resolve(" Recovered. ");
    await flush();
    expect(inserted).toEqual(["Recovered."]);
    expect(controller.current).toMatchObject({ state: "IDLE", transcript: "Recovered." });
    expect(dropped.calls.filter((call) => call === "end")).toHaveLength(0);
  });

  it("recovers when the live connection fails before it opens", async () => {
    const { capture, controller, provider, current, inserted, recoveries } = setup();
    const started = controller.start(provider);
    await flush();
    capture.onChunk?.(chunk(1));
    current().drop();
    await started;
    await flush();
    expect(controller.current.state).toBe("CONNECTING");

    await controller.stop();
    await flush();
    expect(recoveries[0]?.audio).toEqual([1, 9]);
    recoveries[0]?.resolve("Offline start.");
    await flush();
    expect(inserted).toEqual(["Offline start."]);
  });

  it("recovers when no final transcript arrives after release", async () => {
    const { controller, current, listen, inserted, recoveries } = setup();
    await listen();
    await controller.stop();
    expect(current().calls.at(-1)).toBe("end");
    current().emit({ type: "error", message: "No final transcript arrived.", retryable: true });
    await flush();
    expect(recoveries).toHaveLength(1);
    recoveries[0]?.resolve("Late but safe.");
    await flush();
    expect(inserted).toEqual(["Late but safe."]);
  });

  it("recovers when the live session is still connecting after the release grace period", async () => {
    const { controller, provider, current, inserted, recoveries } = setup({ limits: { connectGraceMs: 5 } });
    void controller.start(provider);
    await flush();
    await controller.stop();
    await wait(15);
    expect(current().calls).toEqual(["connect", "close"]);
    expect(recoveries).toHaveLength(1);

    current().resolveConnect?.();
    recoveries[0]?.resolve("From buffer.");
    await flush();
    expect(inserted).toEqual(["From buffer."]);
  });

  it("returns to a usable ERROR when recovery fails, and the next utterance is unaffected", async () => {
    const { controller, current, listen, inserted, recoveries, provider } = setup();
    await listen();
    current().drop();
    await controller.stop();
    await flush();
    recoveries[0]?.reject(new Error("Transcription is temporarily unavailable. Try again."));
    await flush();
    expect(controller.current).toMatchObject({ state: "ERROR", error: "Transcription is temporarily unavailable. Try again." });

    const pressed = controller.press(provider);
    await flush();
    current().resolveConnect?.();
    await pressed;
    await flush();
    await controller.stop();
    current().emit({ type: "finalTranscript", text: "Fresh." });
    await flush();
    expect(inserted).toEqual(["Fresh."]);
    expect(recoveries).toHaveLength(1);
  });

  it("times out a stuck recovery", async () => {
    const { controller, current, listen, recoveries } = setup({ limits: { recoveryTimeoutMs: 5 } });
    await listen();
    current().drop();
    await controller.stop();
    await wait(15);
    expect(recoveries[0]?.signal.aborted).toBe(true);
    expect(controller.current).toMatchObject({ state: "ERROR", error: "Transcription timed out. Please try again." });
  });

  it("cancel during recovery aborts it and never inserts", async () => {
    const { controller, current, listen, inserted, recoveries } = setup();
    await listen();
    current().drop();
    await controller.stop();
    await flush();
    await controller.cancel();
    expect(recoveries[0]?.signal.aborted).toBe(true);
    recoveries[0]?.resolve("Should not appear.");
    await flush();
    expect(inserted).toEqual([]);
    expect(controller.current).toMatchObject({ state: "IDLE", error: null });
  });

  it("a stale recovery result cannot insert into a later utterance", async () => {
    const { controller, current, listen, inserted, recoveries } = setup();
    await listen();
    current().drop();
    await controller.stop();
    await flush();
    const stale = recoveries[0];
    await controller.cancel();

    await listen();
    await controller.stop();
    stale?.resolve("Stale.");
    current().emit({ type: "finalTranscript", text: "Current." });
    await flush();
    expect(inserted).toEqual(["Current."]);
  });

  it("reports a recovery with an empty transcript as no speech", async () => {
    const { controller, current, listen, inserted, recoveries } = setup();
    await listen();
    current().drop();
    await controller.stop();
    await flush();
    recoveries[0]?.resolve("");
    await flush();
    expect(controller.current).toMatchObject({ state: "ERROR", error: NO_SPEECH });
    expect(inserted).toEqual([]);
  });
});

describe("DictationController limits", () => {
  it("discards an accidental quick tap without transcribing or inserting", async () => {
    const { controller, current, listen, inserted, recoveries } = setup({ limits: { minAudioBytes: 4 } });
    await listen();
    await controller.stop();
    await flush();
    expect(controller.current).toMatchObject({ state: "IDLE", error: null, transcript: "" });
    expect(current().calls).not.toContain("end");
    expect(current().calls.at(-1)).toBe("close");
    expect(recoveries).toHaveLength(0);
    expect(inserted).toEqual([]);
  });

  it("auto-stops at the maximum utterance length and still transcribes", async () => {
    const { controller, current, listen, inserted } = setup({ limits: { maxUtteranceMs: 5 } });
    await listen();
    await wait(15);
    expect(controller.current.state).toBe("FINALIZING");
    expect(current().calls.at(-1)).toBe("end");
    await controller.stop();
    current().emit({ type: "finalTranscript", text: "Long." });
    await flush();
    expect(inserted).toEqual(["Long."]);
  });
});

describe("DictationController timings", () => {
  /** A clock that advances 10 ms per reading, so each stage has a known duration. */
  function ticking() {
    let t = 0;
    return () => (t += 10);
  }

  it("reports stage durations for an inserted live utterance", async () => {
    const timings: UtteranceTimings[] = [];
    const { capture, controller, current, listen } = setup({ limits: { now: ticking(), onTimings: (t) => timings.push(t) } });
    await listen();
    capture.onChunk?.(chunk(1));
    await controller.stop();
    current().emit({ type: "finalTranscript", text: "Timed." });
    await flush();
    expect(timings).toHaveLength(1);
    const [first] = timings;
    expect(first?.recovered).toBe(false);
    expect(first?.pressToLive).toBeGreaterThan(0);
    expect(first?.pressToAudio).toBeGreaterThan(first?.pressToLive ?? Infinity);
    expect(first?.releaseToFinal).toBe(10);
    expect(first?.finalToDelivered).toBe(10);
    expect(first?.totalMs).toBeGreaterThan(0);
  });

  it("marks recovered utterances and skips empty ones", async () => {
    const timings: UtteranceTimings[] = [];
    const { controller, current, listen, recoveries } = setup({ limits: { now: ticking(), onTimings: (t) => timings.push(t) } });
    await listen();
    current().drop();
    await controller.stop();
    await flush();
    recoveries[0]?.resolve("Recovered.");
    await flush();
    expect(timings[0]?.recovered).toBe(true);

    await listen();
    await controller.stop();
    current().emit({ type: "finalTranscript", text: "  " });
    await flush();
    expect(timings).toHaveLength(1);
  });

  it("formats one line without transcript content", () => {
    expect(formatTimings({ pressToAudio: 120, pressToLive: null, releaseToFinal: 640, finalToDelivered: 25, totalMs: 900, recordingMs: 400, recovered: true }))
      .toBe("press→audio 120 ms · press→live – · release→final 640 ms (recovered) · final→delivered 25 ms");
  });
});
