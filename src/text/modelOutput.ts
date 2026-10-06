/** Stable low-cost Gemini text model. Thinking is off by default. */
export const TEXT_ACTION_MODEL = "gemini-3.5-flash-lite";

/** Source text and instruction are capped before they leave the device. */
export const MAX_TEXT_ACTION_CHARS = 20_000;

const SYSTEM_INSTRUCTION = "Transform the input text so it follows the instruction. Return only the transformed text, with no preamble or explanation.";

/** Why this pair cannot be sent, or `null` when it can. */
export function textActionInputProblem(selection: string, instruction: string): string | null {
  if (!selection.trim()) return "Add text to transform first.";
  if (!instruction.trim()) return "Add transform instructions.";
  if (selection.length > MAX_TEXT_ACTION_CHARS) return `The text is too long (at most ${MAX_TEXT_ACTION_CHARS} characters).`;
  if (instruction.length > MAX_TEXT_ACTION_CHARS) return `The instruction is too long (at most ${MAX_TEXT_ACTION_CHARS} characters).`;
  return null;
}

/** `generateContent` body. The model id stays with the caller, not in this payload. */
export function textActionRequestBody(selection: string, instruction: string): {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: string; parts: { text: string }[] }[];
} {
  return {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{
      role: "user",
      parts: [{ text: `Instruction:\n${instruction.trim()}\n\nInput text:\n${selection}` }],
    }],
  };
}

/**
 * Text from a Gemini `generateContent` response.
 * Thought parts are skipped. Empty output is a failure, not a blank transform.
 */
export function parseModelOutput(body: unknown): string {
  if (typeof body !== "object" || body === null) throw new Error("The transform was empty.");
  const candidates = (body as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) throw new Error("The transform was empty.");
  const first: unknown = candidates[0];
  if (typeof first !== "object" || first === null) throw new Error("The transform was empty.");
  const content = (first as { content?: unknown }).content;
  if (typeof content !== "object" || content === null) throw new Error("The transform was empty.");
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) throw new Error("The transform was empty.");
  const text = parts
    .map((part: unknown) => {
      if (typeof part !== "object" || part === null) return "";
      const record = part as { text?: unknown; thought?: unknown };
      if (record.thought === true || typeof record.text !== "string") return "";
      return record.text;
    })
    .join("")
    .trim();
  if (!text) throw new Error("The transform was empty.");
  return text;
}
