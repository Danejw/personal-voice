import { describe, expect, it } from "vitest";
import { runComputerTask, type ComputerTaskHost } from "@/assistant/computerTask";

function host(partial: Partial<ComputerTaskHost> & Pick<ComputerTaskHost, "propose">): ComputerTaskHost & { executed: string[]; confirmed: string[] } {
  const executed: string[] = [];
  const confirmed: string[] = [];
  return {
    executed,
    confirmed,
    now: () => 0,
    stopped: () => false,
    capture: async () => ({ jpeg: "img", width: 100, height: 100 }),
    execute: async (call) => {
      executed.push(call.name);
      return `Ran ${call.name}.`;
    },
    confirm: async (explanation) => {
      confirmed.push(explanation);
      return true;
    },
    ...partial,
    propose: partial.propose,
  };
}

describe("computer task loop", () => {
  it("executes one allowed click and returns the model's finish text", async () => {
    let calls = 0;
    const task = host({
      propose: async () => {
        calls += 1;
        if (calls === 1) {
          return { id: "step-1", steps: [{ type: "function_call", name: "click", arguments: { x: 10, y: 20 } }] };
        }
        return { id: "step-2", steps: [{ type: "model_output", content: [] }], text: "The button is pressed." };
      },
    });
    await expect(runComputerTask("Click the harmless button.", task)).resolves.toBe("The button is pressed.");
    expect(task.executed).toEqual(["click"]);
  });

  it("does not execute a step the user cancels", async () => {
    const task = host({
      propose: async () => ({
        id: "step-1",
        steps: [{ type: "function_call", name: "type", arguments: { text: "hello", press_enter: true } }],
      }),
      confirm: async () => false,
    });
    await expect(runComputerTask("Type and submit.", task)).resolves.toBe("Stopped. Nothing further was done.");
    expect(task.executed).toEqual([]);
  });

  it("stops immediately when Stop is set", async () => {
    const task = host({
      stopped: () => true,
      propose: async () => ({ id: "x", steps: [{ type: "function_call", name: "click", arguments: { x: 1, y: 1 } }] }),
    });
    await expect(runComputerTask("Keep going.", task)).resolves.toBe("Stopped. Nothing further was done.");
    expect(task.executed).toEqual([]);
  });

  it("stops on the step cap without a ninth action", async () => {
    let step = 0;
    const task = host({
      propose: async () => {
        step += 1;
        return { id: `s-${step}`, steps: [{ type: "function_call", name: "move", arguments: { x: step, y: 1 } }] };
      },
    });
    await expect(runComputerTask("Move around.", task)).resolves.toContain("Stopped after 8 steps");
    expect(task.executed).toHaveLength(8);
  });
});
