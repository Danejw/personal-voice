export interface TransformProfile {
  id: string;
  name: string;
  instruction: string;
  builtIn: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export const BUILT_IN_TRANSFORMS: readonly TransformProfile[] = [
  {
    id: "builtin:polish",
    name: "Polish",
    instruction: "Improve the clarity, grammar, structure, and conciseness of this text while preserving its meaning, tone, and important details. Return only the polished text.",
    builtIn: true,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: "builtin:prompt-engineer",
    name: "Prompt Engineer",
    instruction: "Turn this text into a high-quality prompt for an AI system. Preserve the user's actual intent and requirements. Organize it clearly with useful context, constraints, desired behavior, and expected output when those are present. Do not invent requirements. Return only the finished prompt.",
    builtIn: true,
    createdAt: null,
    updatedAt: null,
  },
];

export const MAX_TRANSFORM_NAME_LENGTH = 80;
export const MAX_TRANSFORM_INSTRUCTION_LENGTH = 20_000;

export function customTransformProblem(name: string, instruction: string): string | null {
  const cleanName = name.trim();
  const cleanInstruction = instruction.trim();
  if (!cleanName) return "Give the transform a name.";
  if (cleanName.length > MAX_TRANSFORM_NAME_LENGTH) return `Names can be at most ${MAX_TRANSFORM_NAME_LENGTH} characters.`;
  if (!cleanInstruction) return "Add transform instructions.";
  if (cleanInstruction.length > MAX_TRANSFORM_INSTRUCTION_LENGTH) {
    return `Instructions can be at most ${MAX_TRANSFORM_INSTRUCTION_LENGTH} characters.`;
  }
  return null;
}

export function transformById(
  custom: readonly TransformProfile[],
  id: string | null,
): TransformProfile | null {
  if (!id) return null;
  return [...BUILT_IN_TRANSFORMS, ...custom].find((profile) => profile.id === id) ?? null;
}

export function transformOptions(custom: readonly TransformProfile[]): readonly TransformProfile[] {
  return [...BUILT_IN_TRANSFORMS, ...custom];
}
