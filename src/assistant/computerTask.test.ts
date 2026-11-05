import { describe, expect, it } from "vitest";
import { REMOTE_COMPUTER_LIMITS, runComputerTask, runComputerTaskReport, type ComputerTaskHost } from "@/assistant/computerTask";

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
          return { id: "step-1", steps: [{ type: "function_call", id: "call-test", name: "click", arguments: { x: 10, y: 20 } }] };
        }
        return { id: "step-2", steps: [{ type: "model_output", content: [] }], text: "The button is pressed." };
      },
    });
    await expect(runComputerTask("Click the harmless button.", task)).resolves.toContain("UNVERIFIED: Model reported: The button is pressed.");
    expect(task.executed).toEqual(["click"]);
  });

  it("does not execute a step the user cancels", async () => {
    const task = host({
      propose: async () => ({
        id: "step-1",
        steps: [{ type: "function_call", id: "call-test", name: "type", arguments: { text: "hello", press_enter: true } }],
      }),
      confirm: async () => false,
    });
    await expect(runComputerTask("Type and submit.", task)).resolves.toContain("STOPPED: Stopped after 0 actions");
    expect(task.executed).toEqual([]);
  });

  it("stops immediately when Stop is set", async () => {
    const task = host({
      stopped: () => true,
      propose: async () => ({ id: "x", steps: [{ type: "function_call", id: "call-test", name: "click", arguments: { x: 1, y: 1 } }] }),
    });
    await expect(runComputerTask("Keep going.", task)).resolves.toContain("STOPPED: Stopped after 0 actions");
    expect(task.executed).toEqual([]);
  });

  it("runs a longer remote goal using the same executor without confirming every click", async () => {
    const progress: number[] = [];
    let count = 0;
    const task = host({
      propose: async () => {
        count += 1;
        return { id: `step-${count}`, steps: [{ type: "function_call", id: "call-test", name: "click", arguments: { x: 50, y: 50 } }] };
      },
      onProgress: step => progress.push(step),
    });
    await expect(runComputerTask("Work through the visible UI.", task,
      { maxSteps: 12, maxDurationMs: REMOTE_COMPUTER_LIMITS.maxDurationMs })).resolves.toContain("Step limit reached after 12 actions");
    expect(task.executed).toHaveLength(12);
    expect(task.confirmed).toHaveLength(0);
    expect(progress).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("stops an extended task as soon as Windows revokes the goal", async () => {
    let stopped = false;
    const task = host({
      stopped: () => stopped,
      propose: async () => ({
        id: "step",
        steps: [{ type: "function_call", id: "call-test", name: "click", arguments: { x: 100, y: 100 } }],
      }),
      execute: async () => { stopped = true; return "Done"; },
    });
    await expect(runComputerTask("Stop on request.", task, REMOTE_COMPUTER_LIMITS))
      .resolves.toContain("STOPPED: Stopped after 1 actions");
  });

  it("stops on the step cap without a ninth action", async () => {
    let step = 0;
    const task = host({
      propose: async () => {
        step += 1;
        return { id: `s-${step}`, steps: [{ type: "function_call", id: "call-test", name: "move", arguments: { x: step, y: 1 } }] };
      },
    });
    await expect(runComputerTask("Move around.", task)).resolves.toContain("Step limit reached after 8 actions");
    expect(task.executed).toHaveLength(8);
  });
  it("preserves function-call identity and the new screenshot in the continuation", async () => {
    let continuation: Record<string, unknown> | null = null;
    let times = 0;
    const task = host({
      propose: async (body) => {
        times += 1;
        if (times === 1) return { id: "interaction-1", steps: [{
          type: "function_call", id: "call-abc", name: "click",
          arguments: { x: 10, y: 12 },
        }] };
        continuation = body;
        return { id: "interaction-2", text: "Clicked.", steps: [] };
      },
    });
    await runComputerTaskReport("Press the button.", task);
    expect(continuation).toMatchObject({
      previousInteractionId: "interaction-1",
      functionResult: { name: "click", callId: "call-abc", image: "img" },
    });
  });

  it("does not execute a model action without its call id", async () => {
    const task = host({ propose: async () => ({ id: "interaction", steps: [{
      type: "function_call", name: "click", arguments: { x: 10, y: 10 },
    }] }) });
    const outcome = await runComputerTaskReport("Click.", task);
    expect(outcome.status).toBe("blocked");
    expect(task.executed).toHaveLength(0);
    expect(outcome.summary).toContain("call ID");
  });

  it("refuses to call an empty model result completed", async () => {
    const task = host({ propose: async () => ({ id: "empty", steps: [] }) });
    const outcome = await runComputerTaskReport("Finish the user's job.", task);
    expect(outcome.status).toBe("unverified");
    expect(outcome.summary).toContain("without an action");
    expect(outcome.steps).toBe(0);
  });

  it("requires fresh visual verification before reporting success", async () => {
    let frames = 0;
    const task = host({
      capture: async () => ({ jpeg: `screen-${++frames}`, width: 100, height: 100 }),
      propose: async () => ({ id: "done", steps: [], text: "The file was saved." }),
      verify: async (_goal, image) => image.jpeg === "screen-2"
        ? "The saved file is visible in the destination folder." : null,
    });
    const outcome = await runComputerTaskReport("Save the file.", task);
    expect(outcome).toMatchObject({ status: "verified", steps: 0 });
    expect(outcome.evidence).toContain("destination folder");
    expect(frames).toBe(2);
  });

  it("keeps a model's completion claim unverified when the fresh screen cannot prove it", async () => {
    const task = host({
      propose: async () => ({ id: "done", steps: [], text: "Email delivered." }),
      verify: async () => null,
    });
    const outcome = await runComputerTaskReport("Deliver email.", task);
    expect(outcome.status).toBe("unverified");
    expect(outcome.evidence).toBeNull();
  });

  it("reports actions already performed before stop, never claims nothing happened", async () => {
    let stop = false;
    const task = host({
      stopped: () => stop,
      propose: async () => ({ id: "click", steps: [{ type: "function_call", id: "call-test", name: "click", arguments: { x: 10, y: 10 } }] }),
      execute: async () => { stop = true; return "Clicked"; },
    });
    const outcome = await runComputerTaskReport("Click then stop.", task);
    expect(outcome).toMatchObject({ status: "stopped", steps: 1 });
    expect(outcome.summary).not.toContain("Nothing further was done");
  });

  it("records the full observe/reason/act/verify sequence without sensitive values", async () => {
    let reads = 0;
    const events: Array<{ stage: string; step: number; action?: string; code?: string }> = [];
    const task = host({
      propose: async () => ++reads === 1
        ? { id: "step-1", steps: [{ type: "function_call", id: "click-1",
          name: "click", arguments: { x: 33, y: 22 } }] }
        : { id: "step-2", text: "A requested sentence is visible.", steps: [] },
      verify: async () => "The sentence is visibly present in Notepad.",
      onTrace: event => events.push(event),
    });
    const report = await runComputerTaskReport("Type a private sentence.", task);
    expect(report.status).toBe("verified");
    expect(events.map(event => event.stage)).toEqual([
      "screen", "model", "acted", "screen", "model", "verified",
    ]);
    expect(events.find(event => event.stage === "acted")).toMatchObject({
      stage: "acted", step: 1, action: "click",
    });
    expect(JSON.stringify(events)).not.toContain("private sentence");
    expect(JSON.stringify(events)).not.toContain('"x"');
  });

  it("records the failing stage when screen capture is unavailable", async () => {
    const events: string[] = [];
    const task = host({
      capture: async () => { throw new Error("capture failed with private details"); },
      propose: async () => ({ steps: [] }),
      onTrace: event => events.push(`${event.stage}:${event.code ?? "none"}`),
    });
    await expect(runComputerTaskReport("Inspect screen.", task)).rejects.toThrow(/capture failed/);
    expect(events).toEqual(["failed:capture"]);
  });

  it("keeps the initial fallback model for every continuation after an action", async () => {
    let calls = 0;
    let continuation: Record<string, unknown> = {};
    const task = host({
      propose: async (body) => {
        if (++calls === 1) return {
          model: "gemini-3.7-flash", id: "fallback-step",
          steps: [{ type: "function_call", id: "call-1", name: "click", arguments: { x: 2, y: 3 } }],
        };
        continuation = body;
        return { model: "gemini-3.7-flash", id: "final", steps: [], text: "Clicked." };
      },
    });
    await runComputerTaskReport("Click the button.", task);
    expect(task.executed).toEqual(["click"]);
    expect(continuation).toMatchObject({
      model: "gemini-3.7-flash", supportsModelFallback: true, previousInteractionId: "fallback-step",
      functionResult: { callId: "call-1" },
    });
  });

  it("traces one typed model failure rather than two terminal failures", async () => {
    const events: Array<{ stage: string; code?: string }> = [];
    const task = host({
      propose: async () => { throw new Error("Computer Use upstream HTTP 503"); },
      onTrace: event => events.push({ stage: event.stage, code: event.code }),
    });
    await expect(runComputerTaskReport("Open Notepad.", task)).rejects.toMatchObject({
      failureCode: "model", message: "Computer Use upstream HTTP 503",
    });
    expect(events.filter(event => event.stage === "failed")).toEqual([
      { stage: "failed", code: "model" },
    ]);
    expect(task.executed).toHaveLength(0);
  });
  it("persists an in-flight checkpoint before the first native action", async () => {
    const order: string[] = [];
    const task = host({
      propose: async () => ({ id: "one", steps: [{
        type: "function_call", id: "call-1", name: "click", arguments: { x: 1, y: 2 },
      }] }),
      onBeforeAction: async (step, name) => { order.push(`before:${step}:${name}`); },
      execute: async () => { order.push("click"); return "Clicked"; },
      onProgress: async (step, name) => { order.push(`after:${step}:${name}`); },
    });
    await runComputerTaskReport("Click.", task, { maxSteps: 1, maxDurationMs: 10000 });
    expect(order).toEqual(["before:0:click", "click", "after:1:click"]);
  });

  it("never executes if the pre-action durable checkpoint is unavailable", async () => {
    const task = host({
      propose: async () => ({ id: "one", steps: [{
        type: "function_call", id: "call-1", name: "click", arguments: { x: 1, y: 2 },
      }] }),
      onBeforeAction: async () => { throw new Error("Failed to write in-flight checkpoint."); },
    });
    await expect(runComputerTaskReport("Click.", task)).rejects.toMatchObject({ failureCode: "tool" });
    expect(task.executed).toHaveLength(0);
  });

  it("never repeats an action when its post-action checkpoint fails", async () => {
    let proposals = 0;
    const task = host({
      propose: async () => { proposals++; return { id: "one", steps: [{
        type: "function_call", id: "call-1", name: "click", arguments: { x: 1, y: 2 },
      }] }; },
      onProgress: async () => { throw new Error("Checkpoint unavailable after click."); },
    });
    await expect(runComputerTaskReport("Click.", task)).rejects.toMatchObject({ failureCode: "tool" });
    expect(proposals).toBe(1);
    expect(task.executed).toEqual(["click"]);
  });

  it("marks the independent verifier before taking its final screenshot", async () => {
    const phases: string[] = [];
    const task = host({
      propose: async () => ({ id: "done", steps: [], text: "Finished." }),
      onBeforeVerify: async () => { phases.push("verifying"); },
      capture: async () => { phases.push("capture"); return { jpeg: "img", width: 100, height: 100 }; },
      verify: async () => "The requested text is visible in Notepad.",
    });
    const result = await runComputerTaskReport("Type text.", task);
    expect(result.status).toBe("verified");
    expect(phases).toEqual(["capture", "verifying", "capture"]);
  });

});
