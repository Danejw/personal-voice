import { describe, expect, it } from "vitest";
import { SpeechEnvelope } from "@/assistant/speechEnvelope";

function pcm(amplitude: number, samples = 480): ArrayBuffer {
  const bytes = new ArrayBuffer(samples * 2);
  const view = new DataView(bytes);
  for (let i = 0; i < samples; i += 1) {
    view.setInt16(i * 2, Math.round(amplitude * 32767), true);
  }
  return bytes;
}

describe("Companion speech energy", () => {
  it("opens proportionally to PCM amplitude and closes when it finishes", () => {
    const envelope = new SpeechEnvelope();
    envelope.enqueue(pcm(.23), 24000, 1000);
    expect(envelope.level(1007)).toBeGreaterThan(.7);
    expect(envelope.level(1025)).toBe(0);
  });

  it("observes silence, queued playback offsets, and interruption", () => {
    const envelope = new SpeechEnvelope();
    envelope.enqueue(pcm(0), 24000, 1000);
    expect(envelope.level(1005)).toBe(0);
    envelope.enqueue(pcm(.25), 24000, 1000, 45);
    expect(envelope.level(1030)).toBe(0);
    expect(envelope.level(1050)).toBeGreaterThan(.7);
    envelope.clear();
    expect(envelope.level(1050)).toBe(0);
  });

  it("does not retain an unbounded history or expose audio content", () => {
    const envelope = new SpeechEnvelope();
    const input = pcm(.1, 960);
    for (let i = 0; i < 300; i++) {
      envelope.enqueue(input, 24000, i * 50);
    }
    expect(envelope.level(20_000)).toBe(0);
    envelope.clear();
    expect(envelope.level(20_000)).toBe(0);
  });
});
