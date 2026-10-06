import { describe, expect, it } from "vitest";
import { parseTextActionResponse } from "@/services/textActionService";

describe("parseTextActionResponse", () => {
  it("returns the transformed text", () => {
    expect(parseTextActionResponse(200, { text: " Shorter. " })).toBe("Shorter.");
  });

  it("uses the server message for non-200 responses", () => {
    expect(() => parseTextActionResponse(401, { error: "Sign in again to transform text." }))
      .toThrow("Sign in again to transform text.");
    expect(() => parseTextActionResponse(502, null)).toThrow("Couldn't transform the text (error 502). Try again.");
  });

  it("treats an empty transform as a failure", () => {
    expect(() => parseTextActionResponse(200, { text: "  " })).toThrow("The transform was empty.");
    expect(() => parseTextActionResponse(200, {})).toThrow("The transform was empty.");
  });
});
