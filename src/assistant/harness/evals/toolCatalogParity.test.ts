import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { assistantFunctionDeclarations } from "@/assistant/tools";
import { ASSISTANT_TOOL_NAMES, toolIntelligence } from "@/assistant/harness/toolIntelligence";
import { TOOL_SELECTION_SCENARIOS } from "@/assistant/harness/evals/fixtures";
import { TOOL_PLAYBOOK_IDS, loadToolPlaybook } from "@/assistant/harness/playbooks";

function declaredRouteNames(): string[] {
  // Structural check of the real TypeScript implementation, not another hand-maintained list.
  const path = fileURLToPath(new URL("../../tools.ts", import.meta.url));
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const router = source.statements.find((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "decideToolCall",
  );
  if (!router || !ts.isFunctionDeclaration(router) || !router.body) {
    throw new Error("decideToolCall router not found; update the harness parity check when its architecture changes.");
  }
  let switchOnToolName: ts.SwitchStatement | null = null;
  function walk(node: ts.Node): void {
    if (
      ts.isSwitchStatement(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(source) === "call" &&
      node.expression.name.text === "name"
    ) switchOnToolName = node;
    ts.forEachChild(node, walk);
  }
  walk(router.body);
  if (!switchOnToolName) throw new Error("No switch(call.name) router found; parity must be updated with any router redesign.");
  const routes: string[] = [];
  // TypeScript's type narrowing for recursive AST discovery can be conservative.
  const selected: ts.SwitchStatement = switchOnToolName;
  for (const clause of selected.caseBlock.clauses) {
    if (ts.isCaseClause(clause) && ts.isStringLiteral(clause.expression)) routes.push(clause.expression.text);
  }
  return routes;
}

describe("Assistant harness tool catalog drift guard", () => {
  it("matches every declared tool 1:1 with the router and intelligence registry", () => {
    const declared = assistantFunctionDeclarations().map((tool) => tool.name);
    const routed = declaredRouteNames();
    const intelligence = [...ASSISTANT_TOOL_NAMES];
    for (const [label, names] of [
      ["declared", declared], ["routed", routed], ["intelligence", intelligence],
    ] as const) {
      expect(new Set(names).size, `${label} contains duplicate tool names`).toBe(names.length);
    }
    expect(routed.slice().sort(), "Every Live tool must be explicitly recognized in decideToolCall; remove orphan routes.")
      .toEqual(declared.slice().sort());
    expect(intelligence.slice().sort(), "Every Live tool must have a matching toolIntelligence profile.")
      .toEqual(declared.slice().sort());
  });

  it("requires exactly one named base eval fixture for every tool, with a measurable objective", () => {
    const declared = assistantFunctionDeclarations().map((tool) => tool.name).sort();
    const base = TOOL_SELECTION_SCENARIOS.filter((scenario) => scenario.id.startsWith("tool-"));
    const names = base.map((scenario) => scenario.id.slice(5));
    expect(names.slice().sort()).toEqual(declared);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(TOOL_SELECTION_SCENARIOS.map((scenario) => scenario.id)).size)
      .toBe(TOOL_SELECTION_SCENARIOS.length);
    for (const scenario of base) {
      const name = scenario.id.slice(5);
      expect(scenario.expected, `Add an actual expected invocation for ${name}`).toContain(name);
      expect(scenario.request.trim().length).toBeGreaterThan(10);
      expect(scenario.successCriterion.trim().length).toBeGreaterThan(10);
      expect(toolIntelligence(name)?.verify.trim().length).toBeGreaterThan(10);
    }
  });

  it("forbids retired or misspelled tools in every versioned playbook", () => {
    const declared = new Set(assistantFunctionDeclarations().map((tool) => tool.name));
    for (const id of TOOL_PLAYBOOK_IDS) {
      const playbook = loadToolPlaybook(id);
      for (const step of playbook.steps) {
        for (const name of step.tools) {
          expect(declared.has(name), `${id} references unknown tool: ${name}`).toBe(true);
        }
      }
    }
  });
});
