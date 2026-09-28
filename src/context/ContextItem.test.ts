import { describe, expect, it } from "vitest";
import { contextItemFromCapture, parseCapturedSelection } from "@/context/ContextItem";

describe("parseCapturedSelection", () => {
  it("keeps the captured text and optional source app", () => {
    expect(parseCapturedSelection({ text: "hello", sourceApp: "Notes" })).toEqual({
      text: "hello",
      sourceApp: "Notes",
    });
  });

  it("omits a missing or blank source app", () => {
    expect(parseCapturedSelection({ text: "hello" })).toEqual({ text: "hello" });
    expect(parseCapturedSelection({ text: "hello", sourceApp: "" })).toEqual({ text: "hello" });
    expect(parseCapturedSelection({ text: "hello", sourceApp: 12 })).toEqual({ text: "hello" });
  });

  it("rejects empty or malformed payloads", () => {
    expect(() => parseCapturedSelection(null)).toThrow("The selected text could not be read.");
    expect(() => parseCapturedSelection({ text: "" })).toThrow("No text is selected in the other app.");
    expect(() => parseCapturedSelection({ text: 1 })).toThrow("No text is selected in the other app.");
  });
});

describe("contextItemFromCapture", () => {
  it("stamps the capture as a selection context item", () => {
    expect(contextItemFromCapture({ text: "world", sourceApp: "Cursor" }, () => "2026-09-28T14:00:00.000Z")).toEqual({
      type: "selection",
      text: "world",
      sourceApp: "Cursor",
      capturedAt: "2026-09-28T14:00:00.000Z",
    });
  });
});
