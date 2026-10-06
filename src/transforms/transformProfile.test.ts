import { describe, expect, it } from "vitest";
import {
  BUILT_IN_TRANSFORMS,
  customTransformProblem,
  transformById,
  type TransformProfile,
} from "@/transforms/transformProfile";

describe("transform profiles", () => {
  it("ships Polish and Prompt Engineer", () => {
    expect(BUILT_IN_TRANSFORMS.map((profile) => profile.name)).toEqual(["Polish", "Prompt Engineer"]);
  });

  it("validates custom profiles", () => {
    expect(customTransformProblem("", "rewrite")).toBe("Give the transform a name.");
    expect(customTransformProblem("My transform", "")).toBe("Add transform instructions.");
    expect(customTransformProblem("My transform", "Rewrite this clearly.")).toBeNull();
  });

  it("resolves built-in and custom profiles by id", () => {
    const custom: TransformProfile = {
      id: "custom-1",
      name: "Coding Agent",
      instruction: "Turn this into a coding task.",
      builtIn: false,
      createdAt: "2026-10-06T00:00:00.000Z",
      updatedAt: "2026-10-06T00:00:00.000Z",
    };
    expect(transformById([custom], "builtin:prompt-engineer")?.name).toBe("Prompt Engineer");
    expect(transformById([custom], "custom-1")).toEqual(custom);
    expect(transformById([custom], "missing")).toBeNull();
  });
});
