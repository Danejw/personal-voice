import { describe, expect, it, vi } from "vitest";
import { LiveFieldPreview } from "@/voice/session/LiveFieldPreview";
import type { DictationSnapshot } from "@/voice/session/DictationController";

function state(
  utterance: number,
  kind: DictationSnapshot["state"],
  partial = "",
): DictationSnapshot {
  return { utterance, state: kind, partial, transcript: "", error: null };
}

describe("LiveFieldPreview", () => {
  it("updates only the active field and replaces partial with final exactly once", async () => {
    const text = vi.fn(async (_phase: string, _value: string) => true);
    const preview = new LiveFieldPreview({ liveDictationText: text });
    preview.observe(state(1, "CONNECTING"), "active-field");
    preview.observe(state(1, "LISTENING", "Hello wor"), "active-field");
    preview.observe(state(1, "LISTENING", "Hello world"), "active-field");
    expect(await preview.commit("Hello, world.")).toBe(true);
    expect(text.mock.calls).toEqual([
      ["update", "Hello wor"],
      ["update", "Hello world"],
      ["commit", "Hello, world."],
    ]);
  });

  it("does not preview Notes or Remote Dictation", async () => {
    const text = vi.fn(async () => true);
    const preview = new LiveFieldPreview({ liveDictationText: text });
    preview.observe(state(1, "LISTENING", "An idea"), "voice-note");
    expect(await preview.commit("An idea.")).toBe(false);
    preview.observe(state(2, "LISTENING", "Go"), "remote-dictation");
    expect(await preview.commit("Go.")).toBe(false);
    expect(text).not.toHaveBeenCalled();
  });

  it("falls back to a single normal final insert when the field does not support preview", async () => {
    const text = vi.fn(async () => false);
    const preview = new LiveFieldPreview({ liveDictationText: text });
    preview.observe(state(1, "LISTENING", "Text"), "active-field");
    expect(await preview.commit("Text.")).toBe(false);
    expect(text).toHaveBeenCalledTimes(1);
  });

  it("cancels the provisional span when recording ends without delivery", async () => {
    const text = vi.fn(async () => true);
    const preview = new LiveFieldPreview({ liveDictationText: text });
    preview.observe(state(1, "LISTENING", "Draft"), "active-field");
    await Promise.resolve();
    preview.observe(state(1, "IDLE"), "active-field");
    // The next operation is serialized after cancellation, so no external timing is needed.
    preview.observe(state(2, "LISTENING", "Another"), "active-field");
    expect(await preview.commit("Another.")).toBe(true);
    expect(text.mock.calls).toEqual([
      ["update", "Draft"],
      ["cancel", ""],
      ["update", "Another"],
      ["commit", "Another."],
    ]);
  });

  it("refuses a final paste if an already populated preview field changed", async () => {
    const text = vi.fn(async (phase: string, value: string) => phase === "update" && value === "First");
    const preview = new LiveFieldPreview({ liveDictationText: text });
    preview.observe(state(1, "LISTENING", "First"), "active-field");
    preview.observe(state(1, "LISTENING", "Second"), "active-field");
    await expect(preview.commit("Final.")).rejects.toThrow("field changed");
    expect(text.mock.calls).toEqual([["update", "First"], ["update", "Second"]]);
  });
});
