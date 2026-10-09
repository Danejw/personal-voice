import { describe, expect, it } from "vitest";
import { assistantFunctionDeclarations, decideToolCall } from "@/assistant/tools";
import { ASSISTANT_TOOL_NAMES, toolIntelligence } from "@/assistant/harness/toolIntelligence";
import {
  ASSISTANT_PLAYBOOK_GUIDANCE,
  TOOL_PLAYBOOK_IDS,
  isToolPlaybookId,
  loadToolPlaybook,
  playbookToolText,
} from "@/assistant/harness/playbooks";

describe("assistant on-demand tool playbooks", () => {
  it("provides seven complete, distinct playbooks referring only to declared tools", () => {
    expect(TOOL_PLAYBOOK_IDS).toHaveLength(7);
    expect(new Set(TOOL_PLAYBOOK_IDS).size).toBe(7);
    const declared = new Set(assistantFunctionDeclarations().map((entry) => entry.name));
    for (const id of TOOL_PLAYBOOK_IDS) {
      const playbook = loadToolPlaybook(id);
      expect(playbook.id).toBe(id);
      expect(playbook.title.length).toBeGreaterThan(8);
      expect(playbook.useWhen.length).toBeGreaterThan(20);
      expect(playbook.skipWhen.length).toBeGreaterThan(20);
      expect(playbook.steps.length).toBeGreaterThanOrEqual(3);
      expect(playbook.recovery.length).toBeGreaterThan(0);
      expect(playbook.completion.length).toBeGreaterThan(0);
      for (const step of playbook.steps) {
        expect(step.goal).toBeTruthy();
        expect(step.when).toBeTruthy();
        expect(step.outcome).toBeTruthy();
        for (const tool of step.tools) {
          expect(declared.has(tool), `${id} references a missing tool: ${tool}`).toBe(true);
          expect(toolIntelligence(tool)).not.toBeNull();
        }
      }
      const payload = playbookToolText(id);
      expect(payload.length).toBeLessThan(8_000);
      const json = JSON.parse(payload);
      expect(json).toMatchObject({ kind: "tool_playbook", id });
      expect(json.steps).toHaveLength(playbook.steps.length);
      expect(payload).not.toContain("run_shell");
      expect(payload).not.toContain("replace_selection");
    }
    expect(declared.size).toBe(ASSISTANT_TOOL_NAMES.length);
    expect(new Set(ASSISTANT_TOOL_NAMES).size).toBe(ASSISTANT_TOOL_NAMES.length);
  });

  it("requires exact IDs and rejects guesses before any playbook retrieval", () => {
    const plan = () => { throw new Error("The playbook must never invoke handoff planning."); };
    expect(isToolPlaybookId("windows_control")).toBe(true);
    expect(isToolPlaybookId("WINDOWS_CONTROL")).toBe(false);
    expect(isToolPlaybookId("supervise_screen")).toBe(false);
    expect(isToolPlaybookId(null)).toBe(false);
    for (const id of TOOL_PLAYBOOK_IDS) {
      expect(decideToolCall({ id: "tool-id", name: "get_tool_playbook", args: { id } }, plan))
        .toEqual({ kind: "playbook", id: "tool-id", name: "get_tool_playbook", playbookId: id });
    }
    for (const invalid of [null, "", "unknown", "windows-control", 10, ["notes_workflow"]]) {
      const result = decideToolCall({ id: "bad", name: "get_tool_playbook", args: { id: invalid } }, plan);
      expect(result).toMatchObject({ kind: "reject", id: "bad", name: "get_tool_playbook" });
    }
    expect(decideToolCall({ id: null, name: "get_tool_playbook", args: { id: "notes_workflow" } }, plan).kind)
      .toBe("ignore");
  });

  it("only advertises optional retrieval for genuinely multi-step requests", () => {
    const tool = assistantFunctionDeclarations().find((entry) => entry.name === "get_tool_playbook");
    expect(tool?.parameters).toMatchObject({
      type: "object",
      properties: { id: { enum: [...TOOL_PLAYBOOK_IDS] } },
      required: ["id"],
    });
    expect(tool?.description).toContain("single-tool");
    expect(ASSISTANT_PLAYBOOK_GUIDANCE).toContain("routine single-tool");
    expect(ASSISTANT_PLAYBOOK_GUIDANCE).toContain("get_tool_playbook");
  });
});
