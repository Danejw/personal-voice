import { describe, expect, it, vi } from "vitest";
import { migrateDestinationId, TranscriptDestinationRouter } from "@/voice/transcript/TranscriptDestination";
import type { TranscriptDestination } from "@/voice/transcript/TranscriptDestination";

describe("migrateDestinationId", () => {
  it("maps legacy send-to-device onto remote-dictation", () => {
    expect(migrateDestinationId("send-to-device")).toBe("remote-dictation");
    expect(migrateDestinationId("remote-dictation")).toBe("remote-dictation");
    expect(migrateDestinationId("active-field")).toBe("active-field");
  });
});

describe("TranscriptDestinationRouter", () => {
  it("routes to the selected destination", async () => {
    const activeField: TranscriptDestination = { deliver: vi.fn().mockResolvedValue(undefined) };
    const voiceNote: TranscriptDestination = { deliver: vi.fn().mockResolvedValue(undefined) };
    const remote: TranscriptDestination = { deliver: vi.fn().mockResolvedValue(undefined) };
    const router = new TranscriptDestinationRouter({
      "active-field": activeField,
      "voice-note": voiceNote,
      "remote-dictation": remote,
    });

    router.select("remote-dictation");
    await router.deliver("hello");
    expect(remote.deliver).toHaveBeenCalledWith("hello");
    expect(activeField.deliver).not.toHaveBeenCalled();
  });

  it("honors a one-shot override then returns to the saved destination", async () => {
    const activeField: TranscriptDestination = { deliver: vi.fn().mockResolvedValue(undefined) };
    const voiceNote: TranscriptDestination = { deliver: vi.fn().mockResolvedValue(undefined) };
    const unused: TranscriptDestination = { deliver: vi.fn().mockResolvedValue(undefined) };
    const router = new TranscriptDestinationRouter({
      "active-field": activeField,
      "voice-note": voiceNote,
      "remote-dictation": unused,
    });

    router.overrideNext("voice-note");
    await router.deliver("note");
    expect(voiceNote.deliver).toHaveBeenCalledWith("note");
    await router.deliver("field");
    expect(activeField.deliver).toHaveBeenCalledWith("field");
  });

  it("reports failure without swallowing the destination error", async () => {
    const failure = new Error("insert failed");
    const activeField: TranscriptDestination = { deliver: vi.fn().mockRejectedValue(failure) };
    const voiceNote: TranscriptDestination = { deliver: vi.fn().mockResolvedValue(undefined) };
    const remote: TranscriptDestination = { deliver: vi.fn().mockResolvedValue(undefined) };
    const onResult = vi.fn();
    const router = new TranscriptDestinationRouter({
      "active-field": activeField,
      "voice-note": voiceNote,
      "remote-dictation": remote,
    }, "active-field", onResult);

    await expect(router.deliver("x")).rejects.toBe(failure);
    expect(onResult).toHaveBeenCalledWith({ text: "x", destination: "active-field", outcome: "failure" });
  });

  it("keeps history observer failures from changing delivery", async () => {
    const activeField: TranscriptDestination = {
      deliver: vi.fn().mockResolvedValue(undefined),
    };
    const unused: TranscriptDestination = { deliver: vi.fn().mockResolvedValue(undefined) };
    const onResult = vi.fn(() => { throw new Error("history boom"); });
    const router = new TranscriptDestinationRouter({
      "active-field": activeField,
      "voice-note": unused,
      "remote-dictation": unused,
    }, "active-field", onResult);

    await expect(router.deliver("ok")).resolves.toBeUndefined();
  });
});
