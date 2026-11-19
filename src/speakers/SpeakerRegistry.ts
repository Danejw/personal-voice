/**
 * In-memory speaker identities. The audio model and encrypted local persistence are
 * separate dependencies: this module never records audio, reads a microphone, or
 * writes speaker biometrics to web storage.
 *
 * An identity is only saved after an explicit enrollment with consent. A primary
 * identity is chosen explicitly and never inferred from voice frequency.
 */
export type SpeakerRole = "primary" | "known";

export interface SpeakerSample {
  /** Unit-length embedding from the declared model. No raw audio is retained. */
  embedding: number[];
  recordedAt: number;
}

export interface SpeakerProfile {
  id: string;
  displayName: string;
  role: SpeakerRole;
  consentedAt: number;
  samples: SpeakerSample[];
}

export interface SpeakerRegistrySnapshot {
  version: 1;
  accountId: string;
  modelId: string;
  dimensions: number;
  profiles: SpeakerProfile[];
}

export interface SpeakerMatchThresholds {
  /** Model-specific cosine similarity, calibrated using real-device evaluations. */
  minSimilarity: number;
  /** Require enough difference between the two strongest identities. */
  minMargin: number;
}

export type SpeakerMatch =
  | { kind: "unknown"; reason: "no-profiles" | "low-confidence" | "ambiguous" }
  | { kind: "identified"; speakerId: string; role: SpeakerRole; displayName: string; similarity: number };

const MAX_SAMPLES = 12;
const MAX_PROFILES = 100;

function validText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) throw new Error(`Invalid ${field}.`);
  return trimmed;
}

function validTime(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid timestamp.");
  return value;
}

/** Refuse zero/non-finite/wrong-sized vectors, then normalize before matching. */
export function normalizeSpeakerEmbedding(value: readonly number[], dimensions: number): number[] {
  if (!Number.isInteger(dimensions) || dimensions < 2 || dimensions > 4096 || value.length !== dimensions) {
    throw new Error("Incompatible speaker embedding dimensions.");
  }
  let squared = 0;
  for (const component of value) {
    if (!Number.isFinite(component)) throw new Error("Non-finite speaker embedding.");
    squared += component * component;
  }
  if (!Number.isFinite(squared) || squared <= 1e-20) throw new Error("Empty speaker embedding.");
  const length = Math.sqrt(squared);
  return Array.from(value, component => component / length);
}

function cosine(left: readonly number[], right: readonly number[]): number {
  return left.reduce((total, value, index) => total + value * right[index], 0);
}

function validThresholds(value: SpeakerMatchThresholds): void {
  if (!Number.isFinite(value.minSimilarity) || value.minSimilarity < -1 || value.minSimilarity > 1
      || !Number.isFinite(value.minMargin) || value.minMargin < 0 || value.minMargin > 2) {
    throw new Error("Speaker thresholds must be calibrated numerical values.");
  }
}

function cloneProfile(profile: SpeakerProfile): SpeakerProfile {
  return {
    ...profile,
    samples: profile.samples.map(sample => ({
      embedding: [...sample.embedding],
      recordedAt: sample.recordedAt,
    })),
  };
}

export class SpeakerRegistry {
  private profiles: SpeakerProfile[] = [];

  constructor(
    readonly accountId: string,
    readonly modelId: string,
    readonly dimensions: number,
  ) {
    validText(accountId, "account");
    validText(modelId, "speaker model");
    normalizeSpeakerEmbedding([1, ...Array.from({ length: dimensions - 1 }, () => 0)], dimensions);
  }

  /** Explicit primary/known enrollment only; unknown speakers are never persisted. */
  enroll(input: {
    id: string;
    displayName: string;
    role: SpeakerRole;
    consentedAt: number;
    embedding: readonly number[];
    recordedAt: number;
  }): SpeakerProfile {
    const id = validText(input.id, "speaker id");
    if (this.profiles.some(profile => profile.id === id)) throw new Error("Speaker already enrolled.");
    if (this.profiles.length >= MAX_PROFILES) throw new Error("Speaker profile limit reached.");
    if (input.role !== "primary" && input.role !== "known") throw new Error("Invalid speaker role.");
    if (input.role === "primary" && this.profiles.some(profile => profile.role === "primary")) {
      throw new Error("A primary speaker is already enrolled.");
    }
    const profile: SpeakerProfile = {
      id,
      displayName: validText(input.displayName, "speaker name"),
      role: input.role,
      consentedAt: validTime(input.consentedAt),
      samples: [{
        embedding: normalizeSpeakerEmbedding(input.embedding, this.dimensions),
        recordedAt: validTime(input.recordedAt),
      }],
    };
    this.profiles.push(profile);
    return cloneProfile(profile);
  }

  /** Only verified samples may update identity; predicted labels must never self-train. */
  addVerifiedSample(id: string, embedding: readonly number[], recordedAt: number): SpeakerProfile {
    const profile = this.profiles.find(item => item.id === id);
    if (!profile) throw new Error("Unknown speaker id.");
    const sample: SpeakerSample = {
      embedding: normalizeSpeakerEmbedding(embedding, this.dimensions),
      recordedAt: validTime(recordedAt),
    };
    profile.samples.push(sample);
    if (profile.samples.length > MAX_SAMPLES) profile.samples.shift();
    return cloneProfile(profile);
  }

  /** User-driven primary assignment, never most-frequent-speaker selection. */
  setPrimary(id: string): void {
    const chosen = this.profiles.find(item => item.id === id);
    if (!chosen) throw new Error("Unknown speaker id.");
    for (const profile of this.profiles) profile.role = profile.id === id ? "primary" : "known";
  }

  rename(id: string, displayName: string): void {
    const profile = this.profiles.find(item => item.id === id);
    if (!profile) throw new Error("Unknown speaker id.");
    profile.displayName = validText(displayName, "speaker name");
  }

  forget(id: string): void {
    this.profiles = this.profiles.filter(profile => profile.id !== id);
  }

  list(): SpeakerProfile[] {
    return this.profiles.map(cloneProfile);
  }

  identify(embedding: readonly number[], thresholds: SpeakerMatchThresholds): SpeakerMatch {
    validThresholds(thresholds);
    const probe = normalizeSpeakerEmbedding(embedding, this.dimensions);
    if (this.profiles.length === 0) return { kind: "unknown", reason: "no-profiles" };
    const scored = this.profiles.map(profile => ({
      profile,
      // Preserve different voice conditions by comparing all verified exemplars.
      score: Math.max(...profile.samples.map(sample => cosine(probe, sample.embedding))),
    })).sort((left, right) => right.score - left.score);
    const best = scored[0];
    if (best.score < thresholds.minSimilarity) return { kind: "unknown", reason: "low-confidence" };
    if (scored.length > 1 && best.score - scored[1].score < thresholds.minMargin) {
      return { kind: "unknown", reason: "ambiguous" };
    }
    return {
      kind: "identified",
      speakerId: best.profile.id,
      role: best.profile.role,
      displayName: best.profile.displayName,
      similarity: best.score,
    };
  }

  snapshot(): SpeakerRegistrySnapshot {
    return {
      version: 1,
      accountId: this.accountId,
      modelId: this.modelId,
      dimensions: this.dimensions,
      profiles: this.list(),
    };
  }

  /**
   * The native encrypted store must pass only a previously-authenticated account's
   * snapshot here. Model changes require a deliberate migration/re-enrollment.
   */
  restore(snapshot: SpeakerRegistrySnapshot): void {
    if (snapshot.version !== 1 || snapshot.accountId !== this.accountId
        || snapshot.modelId !== this.modelId || snapshot.dimensions !== this.dimensions
        || !Array.isArray(snapshot.profiles) || snapshot.profiles.length > MAX_PROFILES) {
      throw new Error("Incompatible speaker registry snapshot.");
    }
    const restored = new SpeakerRegistry(this.accountId, this.modelId, this.dimensions);
    for (const profile of snapshot.profiles) {
      if (!Array.isArray(profile.samples) || profile.samples.length === 0
          || profile.samples.length > MAX_SAMPLES) throw new Error("Invalid speaker samples.");
      const first = profile.samples[0];
      restored.enroll({
        id: profile.id,
        displayName: profile.displayName,
        role: profile.role,
        consentedAt: profile.consentedAt,
        embedding: first.embedding,
        recordedAt: first.recordedAt,
      });
      for (const sample of profile.samples.slice(1)) {
        restored.addVerifiedSample(profile.id, sample.embedding, sample.recordedAt);
      }
    }
    // Swap only after all validation succeeds, leaving live state intact on error.
    this.profiles = restored.profiles;
  }
}
