export const INSIGHTS_MODEL = "gemini-3.5-flash-lite";
export const MAX_INSIGHTS_INPUT_CHARS = 80_000;

export interface ModelCatchphrase {
  text: string;
  count: number;
}

export interface ModelCandidate {
  kind: "dictionary" | "snippet" | "transform" | "memory";
  title: string;
  payload: Record<string, unknown>;
  evidenceCount: number;
  confidence: "high" | "medium";
  reason: string;
}

export interface ChunkInsightOutput {
  observations: string[];
  catchphrases: ModelCatchphrase[];
  candidates: ModelCandidate[];
}

export interface FinalInsightOutput {
  voiceProfile: string;
  catchphrases: ModelCatchphrase[];
  candidates: ModelCandidate[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function cleanString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function positiveInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function catchphrases(value: unknown): ModelCatchphrase[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((raw) => {
    const item = record(raw);
    return { text: cleanString(item.text, 160), count: positiveInt(item.count) };
  }).filter((item) => item.text && item.count > 0);
}

function candidate(value: unknown): ModelCandidate | null {
  const item = record(value);
  const kind = item.kind;
  if (kind !== "dictionary" && kind !== "snippet" && kind !== "transform" && kind !== "memory") return null;
  const title = cleanString(item.title, 160);
  const reason = cleanString(item.reason, 1000);
  const evidenceCount = positiveInt(item.evidenceCount);
  const confidence = item.confidence === "high" ? "high" : item.confidence === "medium" ? "medium" : null;
  const payload = record(item.payload);
  if (!title || !reason || !evidenceCount || !confidence) return null;
  return { kind, title, payload, evidenceCount, confidence, reason };
}

function candidates(value: unknown): ModelCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).map(candidate).filter((item): item is ModelCandidate => item !== null);
}

export function parseChunkInsight(value: unknown): ChunkInsightOutput {
  const body = record(value);
  const observations = Array.isArray(body.observations)
    ? body.observations.map((item) => cleanString(item, 800)).filter(Boolean).slice(0, 24)
    : [];
  return { observations, catchphrases: catchphrases(body.catchphrases), candidates: candidates(body.candidates) };
}

export function parseFinalInsight(value: unknown): FinalInsightOutput {
  const body = record(value);
  const voiceProfile = cleanString(body.voiceProfile, 8000);
  if (!voiceProfile) throw new Error("The Insights analysis did not return a voice profile.");
  return { voiceProfile, catchphrases: catchphrases(body.catchphrases), candidates: candidates(body.candidates) };
}

export function parseGeminiJson(body: unknown): unknown {
  const root = record(body);
  const candidatesRaw = Array.isArray(root.candidates) ? root.candidates : [];
  const first = record(candidatesRaw[0]);
  const content = record(first.content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const text = parts.map((part) => {
    const item = record(part);
    return item.thought === true ? "" : cleanString(item.text, MAX_INSIGHTS_INPUT_CHARS);
  }).join("").trim();
  if (!text) throw new Error("The Insights analysis was empty.");
  const fenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(fenced);
}

const CHUNK_SYSTEM = `Analyze a numbered batch of dictations from one user.
Return JSON only with keys observations, catchphrases, candidates.

Do not diagnose, stereotype, infer demographics, infer sensitive traits, or assign the user to predefined communication/personality categories.
Observe only recurring language and workflow patterns supported by the text.

Candidate rules:
- dictionary: a specialized word/name/term repeatedly used and likely useful to recognition. Require evidence across at least 5 distinct dictations.
  payload = {"term":"..."}
- snippet: substantially repeated boilerplate/instruction that could be recalled by a short spoken trigger. Require at least 5 occurrences.
  payload = {"trigger":"...","content":"..."}
- transform: repeated request for the same kind of rewriting/formatting. Require at least 5 occurrences.
  payload = {"name":"...","instruction":"..."}
- memory: a stable user preference explicitly demonstrated repeatedly, not a guess about identity/personality. Require at least 5 occurrences.
  payload = {"kind":"preference"|"fact","key":"snake_case_key","value":"..."}

Each candidate also has kind, title, evidenceCount, confidence ("high" or "medium"), reason.
Catchphrases are recurring phrases the user actually says, with conservative counts.
Keep observations concise and evidence-based.`;

const MERGE_SYSTEM = `Create a durable Personal Voice profile from chunk analyses and deterministic usage facts.
Return JSON only with keys voiceProfile, catchphrases, candidates.

The voiceProfile must be natural free-form prose, not labels or a taxonomy. Do not force the user into boxes such as conversational, technical, directive, professional, introvert/extrovert, or personality types.
Describe observed dictation habits dynamically: how thoughts are formed, revised, constrained, structured, repeated, or contextualized. Mention uncertainty when evidence is weak.
Do not infer demographics, health, politics, religion, sexuality, personality disorders, occupation, or other sensitive/personal attributes beyond what the dictation wording directly demonstrates.

Merge recurring evidence across chunks. Do not invent counts. Prefer fewer strong suggestions over noisy ones.
Candidate payloads follow:
dictionary {"term":"..."}
snippet {"trigger":"...","content":"..."}
transform {"name":"...","instruction":"..."}
memory {"kind":"preference"|"fact","key":"snake_case_key","value":"..."}
Each candidate has kind, title, evidenceCount, confidence ("high" or "medium"), reason.
Only retain candidates with evidence from at least 5 distinct dictations.
Return no more than 10 candidates per kind and 12 catchphrases.`;

export function insightRequestBody(mode: "chunk" | "merge", input: string): Record<string, unknown> {
  if (!input.trim()) throw new Error("Insights needs dictation text to analyze.");
  if (input.length > MAX_INSIGHTS_INPUT_CHARS) throw new Error("That Insights batch is too large.");
  const system = mode === "chunk" ? CHUNK_SYSTEM : MERGE_SYSTEM;
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: input }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: mode === "chunk" ? 0.2 : 0.3,
    },
  };
}
