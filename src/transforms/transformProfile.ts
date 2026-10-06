export interface TransformProfile {
  id: string;
  name: string;
  instruction: string;
  builtIn: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const BUILT_IN_TRANSFORMS: readonly TransformProfile[] = [
  {
    id: "builtin:polish",
    name: "Polish",
    instruction: "Improve clarity, grammar, structure, and conciseness while preserving the meaning, tone, and important details. Return only the polished text.",
    builtIn: true,
  },
  {
    id: "builtin:prompt-engineer",
    name: "Prompt Engineer",
    instruction: "Turn this text into a high-quality prompt for an AI system. Preserve the user's actual intent and requirements. Organize useful context, constraints, desired behavior, and expected output when present. Do not invent requirements. Return only the finished prompt.",
    builtIn: true,
  },
];

export function transformProfileFromRow(row: {
  id: string;
  name: string;
  instruction: string;
  created_at: string;
  updated_at: string;
}): TransformProfile {
  return {
    id: row.id,
    name: row.name,
    instruction: row.instruction,
    builtIn: false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function transformNameProblem(name: string): string | null {
  const value = name.trim();
  if (!value) return "Name this transform.";
  if (value.length > 80) return "Transform names can be at most 80 characters.";
  return null;
}

export function transformInstructionProblem(instruction: string): string | null {
  const value = instruction.trim();
  if (!value) return "Add transform instructions.";
  if (value.length > 20_000) return "Transform instructions can be at most 20,000 characters.";
  return null;
}
