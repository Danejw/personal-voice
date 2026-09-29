import { describe, expect, it } from "vitest";
import type { ContextItem } from "@/context/ContextItem";
import { canReplace, selectionFlowReducer } from "@/text/selectionAction";
import type { SelectionFlow } from "@/text/selectionAction";

const item: ContextItem = { type: "selection", text: "A long sentence.", capturedAt: "2026-09-28T12:00:00.000Z" };

function reduce(state: SelectionFlow, ...actions: Parameters<typeof selectionFlowReducer>[1][]): SelectionFlow {
  return actions.reduce(selectionFlowReducer, state);
}

describe("selectionFlowReducer", () => {
  it("reaches preview only after a non-empty rewrite, which is the only replaceable phase", () => {
    const preview = reduce(
      { phase: "idle" },
      { type: "listen" },
      { type: "captured", item },
      { type: "instruction", text: "make this shorter" },
      { type: "preview", result: "A sentence." },
    );
    expect(preview).toEqual({ phase: "preview", item, instruction: "make this shorter", result: "A sentence." });
    expect(canReplace(preview)).toBe(true);
  });

  it("does not offer replace after a failed transform", () => {
    const failed = reduce(
      { phase: "transforming", item, instruction: "make this shorter" },
      { type: "fail", message: "Could not reach Gemini." },
    );
    expect(failed).toEqual({ phase: "error", item, message: "Could not reach Gemini." });
    expect(canReplace(failed)).toBe(false);
  });

  it("does not offer replace after cancel, and keeps the captured selection", () => {
    const transforming = { phase: "transforming", item, instruction: "make this shorter" } as const;
    expect(canReplace(selectionFlowReducer(transforming, { type: "cancel" }))).toBe(false);
    expect(selectionFlowReducer(transforming, { type: "cancel" })).toEqual({ phase: "captured", item });

    const preview = { phase: "preview", item, instruction: "make this shorter", result: "A sentence." } as const;
    expect(selectionFlowReducer(preview, { type: "cancel" })).toEqual({ phase: "captured", item });
    expect(canReplace(selectionFlowReducer(preview, { type: "cancel" }))).toBe(false);
  });

  it("treats an empty rewrite as an error instead of a preview", () => {
    const empty = selectionFlowReducer(
      { phase: "transforming", item, instruction: "make this shorter" },
      { type: "preview", result: "  " },
    );
    expect(empty.phase).toBe("error");
    expect(canReplace(empty)).toBe(false);
  });

  it("ignores a preview that does not follow a transform", () => {
    const captured = { phase: "captured", item } as const;
    expect(selectionFlowReducer(captured, { type: "preview", result: "nope" })).toBe(captured);
  });

  it("waits for a capture that happens during the hold before it can transform", () => {
    const listening = selectionFlowReducer({ phase: "idle" }, { type: "listen" });
    expect(listening).toEqual({ phase: "listening", item: null });
    expect(selectionFlowReducer(listening, { type: "instruction", text: "make this shorter" })).toBe(listening);
    expect(selectionFlowReducer(listening, { type: "captured", item })).toEqual({ phase: "listening", item });
  });

  it("rejects a blank instruction before transforming", () => {
    const blank = selectionFlowReducer({ phase: "listening", item }, { type: "instruction", text: "  " });
    expect(blank).toEqual({ phase: "error", item, message: "Say what to do with the selection." });
    expect(canReplace(blank)).toBe(false);
  });
});
