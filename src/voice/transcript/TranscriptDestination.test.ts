import { describe, expect, it, vi } from "vitest";
import { TranscriptDestinationRouter } from "@/voice/transcript/TranscriptDestination";
import type { TranscriptDestination } from "@/voice/transcript/TranscriptDestination";

describe("TranscriptDestinationRouter", () => {
  it("delivers a finalized transcript to the selected destination", async () => {
    const activeField: TranscriptDestination = { deliver: vi.fn().mockResolvedValue(undefined) };
    const voiceNote: TranscriptDestination = { deliver: vi.fn().mockResolvedValue(undefined) };
    const handoff: TranscriptDestination = { deliver: vi.fn().mockResolvedValue(undefined) };
    const router = new TranscriptDestinationRouter({
      "active-field": activeField,
      "voice-note": voiceNote,
      "send-to-device": handoff,
    });

    await router.deliver("Hello.");
    router.select("voice-note");
    await router.deliver("Remember this.");
    router.select("send-to-device");
    await router.deliver("Continue this elsewhere.");

    expect(activeField.deliver).toHaveBeenCalledOnce();
    expect(activeField.deliver).toHaveBeenCalledWith("Hello.");
    expect(voiceNote.deliver).toHaveBeenCalledOnce();
    expect(voiceNote.deliver).toHaveBeenCalledWith("Remember this.");
    expect(handoff.deliver).toHaveBeenCalledOnce();
    expect(handoff.deliver).toHaveBeenCalledWith("Continue this elsewhere.");
  });

  it("sends one utterance to an override without changing the saved destination", async () => {
    const activeField: TranscriptDestination = { deliver: vi.fn().mockResolvedValue(undefined) };
    const voiceNote: TranscriptDestination = { deliver: vi.fn().mockResolvedValue(undefined) };
    const unused: TranscriptDestination = { deliver: vi.fn().mockResolvedValue(undefined) };
    const router = new TranscriptDestinationRouter({
      "active-field": activeField,
      "voice-note": voiceNote,
      "send-to-device": unused,
    });

    router.overrideNext("voice-note");
    await router.deliver("A note.");
    await router.deliver("Typed.");

    expect(voiceNote.deliver).toHaveBeenCalledWith("A note.");
    expect(activeField.deliver).toHaveBeenCalledWith("Typed.");
    expect(router.selected).toBe("active-field");
  });

  it("surfaces destination failures to the caller", async () => {
    const failure = new Error("The active field rejected the transcript.");
    const activeField: TranscriptDestination = { deliver: vi.fn().mockRejectedValue(failure) };
    const voiceNote: TranscriptDestination = { deliver: vi.fn().mockResolvedValue(undefined) };
    const handoff: TranscriptDestination = { deliver: vi.fn().mockResolvedValue(undefined) };
    const router = new TranscriptDestinationRouter({
      "active-field": activeField,
      "voice-note": voiceNote,
      "send-to-device": handoff,
    });

    await expect(router.deliver("Keep me.")).rejects.toBe(failure);
  });

  it("reports destination metadata for successful and failed finalized dictations", async () => {
    const failure = new Error("Paste failed.");
    const activeField: TranscriptDestination = {
      deliver: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(failure),
    };
    const unused: TranscriptDestination = { deliver: vi.fn().mockResolvedValue(undefined) };
    const onResult = vi.fn();
    const router = new TranscriptDestinationRouter({
      "active-field": activeField,
      "voice-note": unused,
      "send-to-device": unused,
    }, "active-field", onResult);

    await router.deliver("Delivered.");
    await expect(router.deliver("Recover this.")).rejects.toBe(failure);

    expect(onResult.mock.calls.map(([result]) => result)).toEqual([
      { text: "Delivered.", destination: "active-field", outcome: "success" },
      { text: "Recover this.", destination: "active-field", outcome: "failure" },
    ]);
  });
});
