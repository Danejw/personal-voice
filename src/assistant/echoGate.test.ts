import { describe, expect, it } from "vitest";
import {
  ECHO_TAIL_MS,
  duplexEchoGate,
  gatedEchoGate,
  microphoneHeld,
  noteRemaining,
  shouldForwardMicrophone,
} from "@/assistant/echoGate";

describe("echo gate", () => {
  it("forwards microphone audio while cancellation is active, including during playback", () => {
    const playing = noteRemaining(duplexEchoGate(), 1_000, 2_000);
    expect(shouldForwardMicrophone(playing, 1_000)).toBe(true);
    expect(microphoneHeld(playing, 1_500)).toBe(false);
  });

  it("withholds audio until playback finishes, then only through the echo tail", () => {
    const playing = noteRemaining(gatedEchoGate(), 1_000, 400);
    expect(shouldForwardMicrophone(playing, 1_000)).toBe(false);
    expect(shouldForwardMicrophone(playing, 1_399)).toBe(false);

    const tail = noteRemaining(playing, 1_400, 0);
    expect(tail.holdUntil).toBe(1_400 + ECHO_TAIL_MS);
    expect(shouldForwardMicrophone(tail, 1_400)).toBe(false);
    expect(shouldForwardMicrophone(tail, 1_400 + ECHO_TAIL_MS - 1)).toBe(false);
    expect(shouldForwardMicrophone(tail, 1_400 + ECHO_TAIL_MS)).toBe(true);
  });

  it("does not start a tail before any playback and does not extend one on later polls", () => {
    const idle = noteRemaining(gatedEchoGate(), 1_000, 0);
    expect(idle.holdUntil).toBe(0);
    expect(shouldForwardMicrophone(idle, 1_000)).toBe(true);

    const tail = noteRemaining(noteRemaining(gatedEchoGate(), 0, 50), 50, 0);
    const polled = noteRemaining(tail, 80, 0);
    expect(polled.holdUntil).toBe(tail.holdUntil);
  });

  it("closes the tail again when more audio is still audible", () => {
    const tail = noteRemaining(noteRemaining(gatedEchoGate(), 0, 100), 100, 0);
    const again = noteRemaining(tail, 120, 300);
    expect(again.holdUntil).toBe(0);
    expect(again.remainingMs).toBe(300);
    expect(shouldForwardMicrophone(again, 200)).toBe(false);
  });

  it("starts the tail from playback completion, not from a turn-complete timestamp", () => {
    const queued = noteRemaining(gatedEchoGate(), 0, 5_000);
    const turnCompleteAt = 100;
    expect(shouldForwardMicrophone(queued, turnCompleteAt)).toBe(false);
    const finished = noteRemaining(queued, 5_000, 0);
    expect(shouldForwardMicrophone(finished, 5_000)).toBe(false);
    expect(shouldForwardMicrophone(finished, 5_000 + ECHO_TAIL_MS)).toBe(true);
  });
});
