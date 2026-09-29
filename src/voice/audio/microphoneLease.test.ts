import { describe, expect, it } from "vitest";
import type { AudioCapture } from "@/voice/audio/AudioCapture";
import { ASSISTANT_HAS_MICROPHONE, gateDictationCapture } from "@/voice/audio/gateDictationCapture";
import { MicrophoneLease } from "@/voice/audio/microphoneLease";

function mic(): AudioCapture & { started: boolean; stopped: boolean } {
  const capture = {
    started: false,
    stopped: false,
    start() {
      capture.started = true;
      return Promise.resolve();
    },
    stop() {
      capture.stopped = true;
      return Promise.resolve();
    },
  };
  return capture;
}

describe("MicrophoneLease", () => {
  it("lets the holder keep the microphone and refuses the other owner", () => {
    const lease = new MicrophoneLease();
    expect(lease.claim("assistant")).toBe(true);
    expect(lease.claim("assistant")).toBe(true);
    expect(lease.claim("dictation")).toBe(false);
    expect(lease.heldBy()).toBe("assistant");
    lease.release("assistant");
    expect(lease.claim("dictation")).toBe(true);
    expect(lease.heldBy()).toBe("dictation");
  });
});

describe("gateDictationCapture", () => {
  it("does not start dictation capture while Assistant holds the microphone", async () => {
    const lease = new MicrophoneLease();
    lease.claim("assistant");
    const inner = mic();
    const gated = gateDictationCapture(inner, lease);
    const errors: string[] = [];
    await expect(gated.start(() => undefined, (message) => errors.push(message))).rejects.toThrow(ASSISTANT_HAS_MICROPHONE);
    expect(inner.started).toBe(false);
    expect(errors).toEqual([ASSISTANT_HAS_MICROPHONE]);
    expect(lease.heldBy()).toBe("assistant");
  });

  it("releases the microphone when dictation capture stops", async () => {
    const lease = new MicrophoneLease();
    const gated = gateDictationCapture(mic(), lease);
    await gated.start(() => undefined, () => undefined);
    expect(lease.heldBy()).toBe("dictation");
    await gated.stop(false);
    expect(lease.heldBy()).toBeNull();
  });
});
