import { describe, expect, it } from "vitest";
import {
  CONTINUATION_PREFIX,
  CONTINUATION_TURN_CHARS,
  CONTINUATION_TURN_LIMIT,
  acceptContinuation,
  buildContinuation,
  classifyHandoffText,
} from "@/assistant/continuation";

const draft = {
  turns: [
    { role: "user" as const, text: "The cross-device code word is pineapple seven." },
    { role: "assistant" as const, text: "Noted." },
  ],
  selection: null,
  notes: [] as { id: string; text: string; createdAt: string }[],
  handoff: null,
  screen: null,
  sourceDeviceId: "phone",
  sourceDeviceName: "Phone",
  createdAt: "2026-09-28T02:00:00.000Z",
};

describe("assistant continuation", () => {
  it("round-trips a versioned package and leaves ordinary text alone", () => {
    const built = buildContinuation(draft);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.text.startsWith(CONTINUATION_PREFIX)).toBe(true);
    expect(JSON.stringify(built.payload)).not.toMatch(/resumeHandle|accessToken|"jpeg"/);
    const classified = classifyHandoffText(built.text);
    expect(classified.kind).toBe("continuation");
    if (classified.kind !== "continuation") return;
    expect(classified.payload.turns[0]?.text).toContain("pineapple seven");
    expect(classified.payload.version).toBe(1);
    expect(classifyHandoffText("Meet at noon.").kind).toBe("text");
    expect(classifyHandoffText(`Notes\n${CONTINUATION_PREFIX}{}`).kind).toBe("text");
  });

  it("bounds turns and rejects a newer or broken package", () => {
    const many = Array.from({ length: CONTINUATION_TURN_LIMIT + 3 }, (_, index) => ({
      role: "user" as const,
      text: `Fact ${index}`,
    }));
    const built = buildContinuation({ ...draft, turns: [{ role: "user", text: "x".repeat(CONTINUATION_TURN_CHARS + 50) }, ...many] });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload.turns.length).toBeLessThanOrEqual(CONTINUATION_TURN_LIMIT);
    expect(built.payload.turns.every((turn) => turn.text.length <= CONTINUATION_TURN_CHARS)).toBe(true);

    const body = JSON.parse(built.text.slice(CONTINUATION_PREFIX.length)) as Record<string, unknown>;
    expect(classifyHandoffText(`${CONTINUATION_PREFIX}{`).kind).toBe("malformed");
    const newer = classifyHandoffText(`${CONTINUATION_PREFIX}${JSON.stringify({ ...body, version: 2 })}`);
    expect(newer.kind).toBe("malformed");
    if (newer.kind === "malformed") expect(newer.message).toMatch(/newer/);
    expect(classifyHandoffText(`${CONTINUATION_PREFIX}${JSON.stringify({ ...body, resumeHandle: "secret" })}`).kind).toBe("malformed");
  });

  it("requires the sending device on the handoff row", () => {
    const built = buildContinuation(draft);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(acceptContinuation(built.payload, { sourceDeviceId: "phone" })).toEqual({ ok: true });
    expect(acceptContinuation(built.payload, { sourceDeviceId: "other" }).ok).toBe(false);
    expect(buildContinuation({ ...draft, turns: [] }).ok).toBe(false);
  });
});
