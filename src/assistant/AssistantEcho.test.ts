import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantController, type AssistantSessionHandle } from "@/assistant/AssistantController";
import { ECHO_TAIL_MS } from "@/assistant/echoGate";
import type { AssistantEvent } from "@/assistant/events";
import type { AudioCapture, CaptureEchoStatus } from "@/voice/audio/AudioCapture";
import { MicrophoneLease } from "@/voice/audio/microphoneLease";

class FakeSession implements AssistantSessionHandle {
  static opened: FakeSession[] = [];
  audio: ArrayBuffer[] = [];
  closed = false;
  constructor(private onEvent: (event: AssistantEvent) => void) {
    FakeSession.opened.push(this);
  }
  connect() {
    this.onEvent({ type: "ready" });
    return Promise.resolve();
  }
  sendTurn() {}
  sendHistory() {}
  sendNote() {}
  sendVideo() {}
  sendToolResponse() {}
  sendAudio(pcm: ArrayBuffer) { this.audio.push(pcm); }
  close() { this.closed = true; }
  emit(event: AssistantEvent) { this.onEvent(event); }
}

class GatePlayback {
  chunks: ArrayBuffer[] = [];
  pending = 0;
  cleared = 0;
  native: boolean[] = [];
  prime() {}
  enqueue(pcm: ArrayBuffer) {
    this.chunks.push(pcm);
    this.pending = 1_000;
  }
  clear() {
    this.cleared += 1;
    this.pending = 0;
    this.chunks = [];
  }
  pendingMs() { return this.pending; }
  setNativeRoute(ready: boolean) { this.native.push(ready); }
}

class GateMic implements AudioCapture {
  stopped = false;
  status: CaptureEchoStatus | void = { fullDuplex: false, nativePlayback: false, noiseSuppression: true };
  private onChunk?: (pcm: ArrayBuffer) => void;
  start(onChunk: (pcm: ArrayBuffer) => void) {
    this.onChunk = onChunk;
    return Promise.resolve(this.status);
  }
  stop() {
    this.stopped = true;
    return Promise.resolve();
  }
  push(pcm: ArrayBuffer) { this.onChunk?.(pcm); }
}

const pcm = (value: number) => Uint8Array.of(value, 0).buffer;

function harness(status: CaptureEchoStatus | void) {
  const playback = new GatePlayback();
  const lease = new MicrophoneLease();
  const mics: GateMic[] = [];
  let next = 0;
  const created = new AssistantController(
    (onEvent) => new FakeSession(onEvent),
    playback,
    () => `id-${next += 1}`,
    () => {
      const mic = new GateMic();
      mic.status = status;
      mics.push(mic);
      return mic;
    },
    lease,
  );
  return { created, playback, mics, lease };
}

async function started(status: CaptureEchoStatus | void) {
  const env = harness(status);
  env.created.start();
  await Promise.resolve();
  await Promise.resolve();
  return env;
}

afterEach(() => {
  FakeSession.opened = [];
  vi.useRealTimers();
});

describe("Assistant echo fallback", () => {
  it("keeps forwarding microphone audio during playback when cancellation is active", async () => {
    vi.useFakeTimers();
    const { created, mics } = await started({ fullDuplex: true, nativePlayback: true, noiseSuppression: true });
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({ type: "audio", pcm: pcm(1) });
    const heard = pcm(2);
    mics[0]?.push(heard);
    expect(session.audio).toEqual([heard]);
    expect(created.getSnapshot().echoFallback).toBe(false);
    expect(created.getSnapshot().playbackHeld).toBe(false);
  });

  it("withholds microphone audio until playback and the echo tail finish, not at turnComplete", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { created, playback, mics } = await started({ fullDuplex: false, nativePlayback: false, noiseSuppression: true });
    const session = FakeSession.opened[0] as FakeSession;
    const before = pcm(1);
    mics[0]?.push(before);
    expect(session.audio).toEqual([before]);

    session.emit({ type: "audio", pcm: pcm(9) });
    session.emit({ type: "turnComplete" });
    const during = pcm(2);
    mics[0]?.push(during);
    expect(session.audio).toEqual([before]);
    expect(created.getSnapshot().status).toBe("READY");
    expect(created.getSnapshot().echoFallback).toBe(true);
    expect(created.getSnapshot().playbackHeld).toBe(true);
    expect(created.getSnapshot().turns.map((turn) => turn.role)).not.toContain("user");

    playback.pending = 0;
    await vi.advanceTimersByTimeAsync(520);
    mics[0]?.push(pcm(3));
    expect(session.audio).toEqual([before]);

    await vi.advanceTimersByTimeAsync(ECHO_TAIL_MS + 30);
    const after = pcm(4);
    mics[0]?.push(after);
    expect(session.audio).toEqual([before, after]);
    expect(created.getSnapshot().playbackHeld).toBe(false);
    expect(mics[0]?.stopped).toBe(false);
  });

  it("stops playback on the interrupt control and resumes listening after the tail", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { created, playback, mics } = await started({ fullDuplex: false, nativePlayback: true, noiseSuppression: false });
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({ type: "outputTranscription", text: "A long reply." });
    session.emit({ type: "audio", pcm: pcm(9) });
    created.interruptPlayback();
    session.emit({ type: "audio", pcm: pcm(8) });
    expect(playback.cleared).toBeGreaterThan(0);
    expect(playback.chunks).toEqual([]);
    expect(created.getSnapshot().status).toBe("READY");
    expect(created.getSnapshot().turns.map((turn) => turn.text)).toEqual(["A long reply."]);
    mics[0]?.push(pcm(1));
    expect(session.audio).toEqual([]);

    await vi.advanceTimersByTimeAsync(ECHO_TAIL_MS + 40);
    const next = pcm(2);
    mics[0]?.push(next);
    expect(session.audio).toEqual([next]);
    expect(playback.native).toEqual([true]);
  });

  it("ends and a failed start release the microphone without leaving the fallback latched", async () => {
    vi.useFakeTimers();
    const { created, mics, lease } = await started({ fullDuplex: false, nativePlayback: false, noiseSuppression: false });
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({ type: "audio", pcm: pcm(1) });
    created.end();
    expect(created.getSnapshot().status).toBe("IDLE");
    expect(created.getSnapshot().echoFallback).toBe(false);
    expect(created.getSnapshot().playbackHeld).toBe(false);
    expect(mics[0]?.stopped).toBe(true);
    expect(lease.heldBy()).toBeNull();
    expect(session.closed).toBe(true);

    const playback = new GatePlayback();
    const failedLease = new MicrophoneLease();
    const failed = new AssistantController(
      (onEvent) => new FakeSession(onEvent),
      playback,
      () => "id",
      () => ({
        start() { return Promise.reject(new Error("The microphone is busy or unavailable.")); },
        stop() { return Promise.resolve(); },
      }),
      failedLease,
    );
    failed.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(failed.getSnapshot().status).toBe("ERROR");
    expect(failed.getSnapshot().echoFallback).toBe(false);
    expect(playback.cleared).toBeGreaterThan(0);
    expect(failedLease.heldBy()).toBeNull();
  });
});
