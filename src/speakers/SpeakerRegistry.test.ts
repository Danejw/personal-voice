import { describe, expect, it } from "vitest";
import { SpeakerRegistry, normalizeSpeakerEmbedding } from "./SpeakerRegistry";

const MODEL = "sherpa-onnx-embedding-model-v1";
const config = { minSimilarity: 0.8, minMargin: 0.1 };

function registry(accountId = "account-a") {
  return new SpeakerRegistry(accountId, MODEL, 3);
}

function primary(book: SpeakerRegistry) {
  return book.enroll({
    id: "owner",
    displayName: "Primary user",
    role: "primary",
    consentedAt: 10,
    recordedAt: 11,
    embedding: [1, 0, 0],
  });
}

describe("SpeakerRegistry", () => {
  it("does not infer or persist an owner from an unknown voice", () => {
    const book = registry();
    expect(book.identify([1, 0, 0], config)).toEqual({ kind: "unknown", reason: "no-profiles" });
    expect(book.list()).toEqual([]);
  });

  it("recognizes an explicitly enrolled primary voice and rejects dissimilar speech", () => {
    const book = registry();
    primary(book);
    expect(book.identify([0.99, 0.02, 0], config)).toMatchObject({
      kind: "identified", speakerId: "owner", role: "primary",
    });
    expect(book.identify([0, 1, 0], config)).toEqual({ kind: "unknown", reason: "low-confidence" });
  });

  it("returns unknown when two enrolled speakers are acoustically ambiguous", () => {
    const book = registry();
    primary(book);
    book.enroll({ id: "guest", displayName: "Guest", role: "known", consentedAt: 15, recordedAt: 16, embedding: [0.98, 0.2, 0] });
    expect(book.identify([1, 0, 0], config)).toEqual({ kind: "unknown", reason: "ambiguous" });
  });

  it("selects primary explicitly, not by sample count", () => {
    const book = registry();
    primary(book);
    book.enroll({ id: "guest", displayName: "Guest", role: "known", consentedAt: 15, recordedAt: 16, embedding: [0, 1, 0] });
    for (let i = 0; i < 20; i++) book.addVerifiedSample("guest", [0, 1, 0], 30 + i);
    expect(book.list().find(profile => profile.id === "owner")?.role).toBe("primary");
    expect(book.list().find(profile => profile.id === "guest")?.samples).toHaveLength(12);
    book.setPrimary("guest");
    expect(book.list().filter(profile => profile.role === "primary").map(profile => profile.id)).toEqual(["guest"]);
  });

  it("does not automatically learn from an identification guess", () => {
    const book = registry();
    primary(book);
    const before = book.list();
    book.identify([0.98, 0.1, 0], config);
    expect(book.list()).toEqual(before);
  });

  it("rejects corrupt, empty, or model-incompatible embeddings", () => {
    expect(() => normalizeSpeakerEmbedding([0, 0, 0], 3)).toThrow();
    expect(() => normalizeSpeakerEmbedding([1, Number.NaN, 0], 3)).toThrow();
    expect(() => normalizeSpeakerEmbedding([1, 0], 3)).toThrow();
    const book = registry();
    expect(() => book.enroll({
      id: "owner", displayName: "Primary", role: "primary", consentedAt: 10,
      recordedAt: 11, embedding: [0, 0],
    })).toThrow();
    expect(book.list()).toHaveLength(0);
    expect(() => book.identify([1, 0, 0], { minSimilarity: Number.NaN, minMargin: 0.1 })).toThrow();
  });

  it("requires unique enrollment and only one primary profile", () => {
    const book = registry();
    primary(book);
    expect(() => primary(book)).toThrow();
    expect(() => book.enroll({
      id: "another", displayName: "Another", role: "primary", consentedAt: 12,
      recordedAt: 13, embedding: [0, 1, 0],
    })).toThrow();
  });

  it("serializes and restores only within the same account and exact model", () => {
    const book = registry();
    primary(book);
    book.addVerifiedSample("owner", [0.9, 0.1, 0], 20);
    const snapshot = book.snapshot();
    const restored = registry();
    restored.restore(snapshot);
    expect(restored.list()).toEqual(book.list());
    expect(() => registry("account-b").restore(snapshot)).toThrow("Incompatible");
    expect(() => new SpeakerRegistry("account-a", "different-model", 3).restore(snapshot)).toThrow("Incompatible");
    const corrupt = structuredClone(snapshot);
    corrupt.profiles[0]!.samples[0]!.embedding[0] = Number.NaN;
    expect(() => restored.restore(corrupt)).toThrow();
    expect(restored.list()).toEqual(book.list());
  });

  it("exposes defensive copies and supports deletion", () => {
    const book = registry();
    const saved = primary(book);
    saved.samples[0]!.embedding[0] = 0;
    const list = book.list();
    list[0]!.samples[0]!.embedding[0] = 0;
    expect(book.list()[0]!.samples[0]!.embedding).toEqual([1, 0, 0]);
    book.rename("owner", "New label");
    expect(book.list()[0]!.displayName).toBe("New label");
    book.forget("owner");
    expect(book.identify([1, 0, 0], config)).toEqual({ kind: "unknown", reason: "no-profiles" });
  });
});
