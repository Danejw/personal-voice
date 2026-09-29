import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_MODEL,
  ASSISTANT_TOKEN_URL,
  DICTATION_MODEL,
  DICTATION_TOKEN_URL,
  geminiMintRequest,
  readTokenPurpose,
} from "@/services/geminiTokenRequest";

const NOW = Date.parse("2026-09-28T00:00:00.000Z");

describe("readTokenPurpose", () => {
  it("keeps a missing purpose on the dictation token", () => {
    expect(readTokenPurpose({})).toBe("dictation");
    expect(readTokenPurpose({ purpose: "dictation" })).toBe("dictation");
  });

  it("accepts an explicit assistant purpose", () => {
    expect(readTokenPurpose({ purpose: "assistant" })).toBe("assistant");
  });

  it("rejects an unknown purpose or a non-object body", () => {
    expect(readTokenPurpose({ purpose: "search" })).toBe("invalid");
    expect(readTokenPurpose([])).toBe("invalid");
    expect(readTokenPurpose("assistant")).toBe("invalid");
    expect(readTokenPurpose(null)).toBe("invalid");
  });
});

describe("geminiMintRequest", () => {
  it("builds the existing v1alpha transcribe token when purpose is dictation", () => {
    const minted = geminiMintRequest("dictation", NOW);
    expect(minted.url).toBe(DICTATION_TOKEN_URL);
    expect(minted.body).toEqual({
      uses: 1,
      expireTime: "2026-09-28T00:15:00.000Z",
      newSessionExpireTime: "2026-09-28T00:02:00.000Z",
      bidiGenerateContentSetup: { model: DICTATION_MODEL },
      fieldMask: "model",
    });
    expect(JSON.stringify(minted.body)).not.toContain("3.8");
    expect(JSON.stringify(minted.body)).not.toContain("v1beta");
  });

  it("locks an assistant token to Gemini 3.8 Live on v1alpha", () => {
    const minted = geminiMintRequest("assistant", NOW);
    expect(minted.url).toBe(ASSISTANT_TOKEN_URL);
    expect(minted.url).toContain("/v1alpha/");
    expect(minted.expireTime).toBe("2026-09-28T00:30:00.000Z");
    expect(minted.newSessionExpireTime).toBe("2026-09-28T00:02:00.000Z");
    expect(minted.body).toEqual({
      uses: 1,
      expireTime: "2026-09-28T00:30:00.000Z",
      newSessionExpireTime: "2026-09-28T00:02:00.000Z",
      bidiGenerateContentSetup: { model: ASSISTANT_MODEL },
      fieldMask: "model",
    });
    expect(JSON.stringify(minted.body)).not.toContain("transcribe");
    expect(JSON.stringify(minted.body)).not.toContain("AIza");
  });
});

describe("edge function copy", () => {
  it("matches the tested token request", () => {
    const source = readFileSync(new URL("./geminiTokenRequest.ts", import.meta.url), "utf8");
    const deployed = readFileSync(new URL("../../supabase/functions/gemini-token/tokenRequest.ts", import.meta.url), "utf8");
    expect(deployed).toBe(source);
  });
});
