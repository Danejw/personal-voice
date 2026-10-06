import { describe, expect, it, vi } from "vitest";
import type { TextAction } from "@/text/TextAction";
import { applyTransform } from "@/transforms/applyTransform";
import { BUILT_IN_TRANSFORMS } from "@/transforms/transformProfile";

describe("applyTransform", () => {
  it("uses the saved instruction through the TextAction boundary", async () => {
    const transform = vi.fn(async ({ selection, instruction }) => `${instruction}: ${selection}`);
    const action: TextAction = { transform };
    const result = await applyTransform(" rough text ", BUILT_IN_TRANSFORMS[0]!, action);
    expect(result).toContain("rough text");
    expect(transform).toHaveBeenCalledWith(
      expect.objectContaining({ instruction: BUILT_IN_TRANSFORMS[0]!.instruction }),
      expect.any(AbortSignal),
    );
  });
});
