import { describe, expect, it } from "vitest";
import { assistantFunctionDeclarations } from "@/assistant/tools";
import {
  ASSISTANT_TOOL_INTELLIGENCE,
  ASSISTANT_TOOL_NAMES,
  enrichToolDescription,
  toolIntelligence,
} from "@/assistant/harness/toolIntelligence";
import { TOOL_SELECTION_SCENARIOS } from "@/assistant/harness/evals/fixtures";
import { scoreToolTrace } from "@/assistant/harness/evals/traceScore";

describe("assistant tool intelligence registry", () => {
  it("covers every current Gemini tool with exactly one complete usage profile", () => {
    const names = assistantFunctionDeclarations().map((item) => item.name);
    expect(names).toHaveLength(53);
    expect(ASSISTANT_TOOL_NAMES).toHaveLength(53);
    expect(new Set(names).size).toBe(53);
    expect(new Set(ASSISTANT_TOOL_NAMES).size).toBe(53);
    expect([...ASSISTANT_TOOL_NAMES].sort()).toEqual([...names].sort());
    for (const [name, item] of Object.entries(ASSISTANT_TOOL_INTELLIGENCE)) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(["all", "windows"]).toContain(item.platform);
      for (const value of [item.when, item.avoid, item.next, item.verify]) {
        expect(value.trim().length).toBeGreaterThan(12);
      }
    }
    expect(toolIntelligence("nonexistent_tool")).toBeNull();
  });

  it("keeps existing tool schemas while giving the model targeted routing hints", () => {
    const declared = assistantFunctionDeclarations();
    const byName = new Map(declared.map((item) => [item.name, item]));
    expect(byName.get("inspect_pointer_context")?.description).toContain("capture_pointer_target");
    expect(byName.get("send_handoff")?.description).toContain("send_remote_dictation");
    expect(byName.get("list_past_conversations")?.description).toContain("search_memory");
    expect(byName.get("capture_screen")?.description).toContain("inspect_pointer_context");
    expect(byName.get("search_memory")?.description).toContain("list_past_conversations");
    expect(byName.get("create_voice_note")?.description).toContain("manual Notes composer");
    expect(byName.get("read_past_conversation")?.parameters.required).toEqual(["conversation_id"]);
    expect(byName.get("copy_text")?.parameters.required).toEqual(["text"]);
    expect(enrichToolDescription("unknown_tool", "existing description")).toBe("existing description");
    const wire = JSON.stringify(declared);
    expect(wire).not.toContain("run_shell");
    expect(wire).not.toContain("replace_selection");
    expect(wire).not.toContain("NON_BLOCKING");
  });
});

describe("deterministic tool-selection trace fixtures", () => {
  it("defines 80 independent scenarios including one for each of the 53 tools", () => {
    expect(TOOL_SELECTION_SCENARIOS).toHaveLength(80);
    expect(new Set(TOOL_SELECTION_SCENARIOS.map((scenario) => scenario.id)).size).toBe(80);
    const singles = TOOL_SELECTION_SCENARIOS.filter((scenario) => scenario.id.startsWith("tool-"));
    expect(singles).toHaveLength(53);
    expect(singles.map((scenario) => scenario.id.slice(5)).sort()).toEqual([...ASSISTANT_TOOL_NAMES].sort());
    expect(TOOL_SELECTION_SCENARIOS.filter((scenario) => scenario.id.startsWith("choice-"))).toHaveLength(20);
    expect(TOOL_SELECTION_SCENARIOS.filter((scenario) => scenario.id.startsWith("none-"))).toHaveLength(7);
    for (const scenario of TOOL_SELECTION_SCENARIOS) {
      expect(scenario.request.trim()).not.toBe("");
      expect(scenario.successCriterion.trim()).not.toBe("");
      for (const name of [...scenario.expected, ...(scenario.forbidden ?? []), ...(scenario.optional ?? []), ...(scenario.firstAnyOf ?? [])]) {
        expect(toolIntelligence(name)).not.toBeNull();
      }
    }
  });

  it("accepts each fixture's expected path as a route, without pretending to verify outcomes", () => {
    for (const scenario of TOOL_SELECTION_SCENARIOS) {
      const result = scoreToolTrace(scenario, scenario.expected);
      expect(result.toolPathPassed, scenario.id).toBe(true);
      expect(result.objectivePassed).toBeNull();
      expect(result.missing).toEqual([]);
      expect(result.unnecessary).toEqual([]);
    }
  });

  it("rejects incorrect first choices, extra tools, repeated actions and wrong order", () => {
    const scenario = TOOL_SELECTION_SCENARIOS.find((item) => item.id === "choice-read-v-resume");
    expect(scenario).toBeDefined();
    if (!scenario) throw new Error("Missing fixture");
    expect(scoreToolTrace(scenario, ["search_memory", ...scenario.expected]).firstToolCorrect).toBe(false);
    expect(scoreToolTrace(scenario, ["list_past_conversations", "continue_past_conversation"]).forbidden)
      .toContain("continue_past_conversation");
    expect(scoreToolTrace(scenario, ["read_past_conversation", "list_past_conversations"]).orderCorrect).toBe(false);
    expect(scoreToolTrace(scenario, ["list_past_conversations", "read_past_conversation", "read_past_conversation"]).unnecessary)
      .toContain("read_past_conversation");
    expect(scoreToolTrace(scenario, ["list_past_conversations", "made_up_tool", "read_past_conversation"]).unknown)
      .toEqual(["made_up_tool"]);
    expect(scoreToolTrace(scenario, ["list_past_conversations", "read_past_conversation"], true).objectivePassed).toBe(true);
    expect(scoreToolTrace(scenario, ["list_past_conversations", "read_past_conversation"], false).objectivePassed).toBe(false);
  });

  it("expects no model tools for simple conversation and correctly flags calls", () => {
    const scenario = TOOL_SELECTION_SCENARIOS.find((item) => item.id === "none-math-only");
    expect(scenario).toBeDefined();
    if (!scenario) throw new Error("Missing fixture");
    expect(scoreToolTrace(scenario, []).toolPathPassed).toBe(true);
    expect(scoreToolTrace(scenario, ["read_usage_analytics"]).toolPathPassed).toBe(false);
  });
});
