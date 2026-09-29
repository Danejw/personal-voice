import { describe, expect, it } from "vitest";
import { parseTextActionResponse } from "@/services/textActionService";

describe("parseTextActionResponse", () => {
  it("returns the rewritten text", () => {
    expect(parseTextActionResponse(200, { text: " Shorter. " })).toBe("Shorter.");
  });

  it("uses the server message for non-200 responses", () => {
    expect(() => parseTextActionResponse(401, { error: "Sign in again to rewrite a selection." }))
      .toThrow("Sign in again to rewrite a selection.");
    expect(() => parseTextActionResponse(502, null)).toThrow("Couldn't rewrite the selection (error 502). Try again.");
  });

  it("treats an empty rewrite as a failure", () => {
    expect(() => parseTextActionResponse(200, { text: "  " })).toThrow("The rewrite was empty.");
    expect(() => parseTextActionResponse(200, {})).toThrow("The rewrite was empty.");
  });
});
