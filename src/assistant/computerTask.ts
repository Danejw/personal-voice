import {
  parseInteraction,
  planComputerStep,
  COMPUTER_STEP_LIMIT,
  COMPUTER_TIME_LIMIT_MS,
  type ComputerCall,
} from "@/assistant/computerActions";

export interface ComputerImage {
  jpeg: string;
  width: number;
  height: number;
}

export type ComputerTaskStatus = "verified" | "unverified" | "stopped" | "blocked";

export interface ComputerTaskReport {
  status: ComputerTaskStatus;
  steps: number;
  summary: string;
  /** Screenshot-derived verification evidence, not an action acknowledgement. */
  evidence: string | null;
}

export interface ComputerTaskTraceEvent {
  stage: "started" | "screen" | "model" | "acted" | "verified" | "unverified" | "stopped" | "blocked" | "failed";
  step: number;
  action?: string;
  code?: "capture" | "model" | "tool" | "verification";
}

/** One typed failure, traced at its source. An outer task handler must not log it again. */
export class ComputerTaskFailure extends Error {
  constructor(readonly failureCode: "capture" | "model" | "tool", cause: unknown) {
    super(cause instanceof Error ? cause.message : "Computer Use failed.");
    this.name = "ComputerTaskFailure";
  }
}

export interface ComputerTaskHost {
  now(): number;
  stopped(): boolean;
  capture(): Promise<ComputerImage>;
  propose(body: Record<string, unknown>): Promise<unknown>;
  execute(call: ComputerCall, image: ComputerImage): Promise<string>;
  confirm(explanation: string): Promise<boolean>;
  /** Persist an in-flight marker before any native side effect. Failure prevents execution. */
  onBeforeAction?(step: number, action: string): Promise<void> | void;
  /** Save the completed-action checkpoint before proceeding to another step. */
  onProgress?(step: number, action: string): Promise<void> | void;
  onBeforeVerify?(step: number): Promise<void> | void;
  /** Read current goal at each safe boundary. A paused job waits here. */
  instructions?(): Promise<string>;
  /** Diagnostic metadata only, never screenshots, prompts, coordinates, or tool arguments. */
  onTrace?(event: ComputerTaskTraceEvent): void;
  /** A fresh post-action screenshot is inspected independently of the action receipt. */
  verify?(goal: string, image: ComputerImage, modelSummary: string): Promise<string | null>;
}

export interface ComputerTaskLimits {
  maxSteps: number;
  maxDurationMs: number;
  allowRoutineDrag?: boolean;
}

/** Server rejects initial Computer Use requests whose goal exceeds 500 chars. */
export const COMPUTER_GOAL_MAX_CHARS = 500;

export function computerVerificationPrompt(objective: string, claim: string): string {
  const brief = (value: string, limit: number) =>
    value.replace(/\s+/g, " ").trim().slice(0, limit);
  return [
    "Independent check using ONLY current screenshot. No tools.",
    "Task: " + brief(objective, 120),
    "Claim: " + brief(claim, 55),
    "VERIFIED: only with concrete visible evidence for the entire task.",
    "Files: editor or Save dialog is not proof of persistence; require reopened exact file and content.",
    "Otherwise NOT_VERIFIED: explain what remains unproven.",
  ].join("\n").slice(0, COMPUTER_GOAL_MAX_CHARS);
}

export const REMOTE_COMPUTER_LIMITS: ComputerTaskLimits = {
  maxSteps: 240,
  maxDurationMs: 30 * 60 * 1000,
  allowRoutineDrag: true,
};

function report(status: ComputerTaskStatus, steps: number, summary: string, evidence: string | null = null): ComputerTaskReport {
  return { status, steps, summary, evidence };
}

/**
 * A goal is never complete merely because a model stops calling tools.
 * Completion requires a fresh screenshot and an explicit postcondition verifier.
 * A stopped/blocked run reports progress without claiming that nothing happened.
 */
export async function runComputerTaskReport(
  goal: string,
  host: ComputerTaskHost,
  limits: ComputerTaskLimits = { maxSteps: COMPUTER_STEP_LIMIT, maxDurationMs: COMPUTER_TIME_LIMIT_MS },
): Promise<ComputerTaskReport> {
  const startedAt = host.now();
  let previousId: string | null = null;
  let selectedModel: string | undefined;
  let result: { name: string; callId: string; result: string; acknowledgement: boolean; imageBase64: string | null } | null = null;
  let executed = 0;
  let verificationRetried = false;
  let verificationFeedback: string | null = null;
  const syncInstructions = async (): Promise<boolean> => {
    const next = await host.instructions?.();
    if (!next || next === goal) return false;
    goal = next;
    previousId = null;
    result = null;
    selectedModel = undefined;
    verificationRetried = false;
    verificationFeedback = null;
    return true;
  };
  for (let step = 0; step < limits.maxSteps; step += 1) {
    if (host.stopped()) return report("stopped", executed, `Stopped after ${executed} actions. The goal was not verified.`);
    if (host.now() - startedAt >= limits.maxDurationMs) {
      return report("blocked", executed, `Time limit reached after ${executed} actions. The goal was not verified.`);
    }
    await syncInstructions();
    if (host.stopped()) return report("stopped", executed, "Computer Use stopped before the next action.");
    let image: ComputerImage;
    try { image = await host.capture(); }
    catch (error) {
      host.onTrace?.({ stage: "failed", step: executed, code: "capture" });
      throw new ComputerTaskFailure("capture", error);
    }
    host.onTrace?.({ stage: "screen", step: executed });
    if (host.stopped()) return report("stopped", executed, `Stopped after ${executed} actions. The goal was not verified.`);
    let interaction;
    try {
      const response = await host.propose({
        goal: verificationFeedback
          ? goal.slice(0, COMPUTER_GOAL_MAX_CHARS - verificationFeedback.length - 2) +
            "\n\n" + verificationFeedback
          : goal,
        image: previousId && !verificationFeedback ? null : image.jpeg,
        previousInteractionId: previousId,
        model: selectedModel,
        supportsModelFallback: true,
        functionResult: result
          ? { name: result.name, callId: result.callId, result: result.result, acknowledgement: result.acknowledgement, image: image.jpeg }
          : null,
      });
      // Only recognized models returned by our server can pin a continuation.
      if (response && typeof response === "object") {
        const proposedModel = (response as { model?: unknown }).model;
        if (proposedModel === "gemini-3.8-flash" || proposedModel === "gemini-3.7-flash") {
          selectedModel = proposedModel;
        }
      }
      interaction = parseInteraction(response);
    } catch (error) {
      host.onTrace?.({ stage: "failed", step: executed, code: "model" });
      throw new ComputerTaskFailure("model", error);
    }
    host.onTrace?.({ stage: "model", step: executed, action: interaction.call?.name });
    if (host.stopped()) return report("stopped", executed, `Stopped after ${executed} actions. The goal was not verified.`);
    if (!interaction.call) {
      const said = interaction.text.trim();
      if (!said) {
        host.onTrace?.({ stage: "unverified", step: executed, code: "verification" });
        return report("unverified", executed, "Computer Use ended without an action or completion evidence.");
      }
      if (!host.verify) {
        host.onTrace?.({ stage: "unverified", step: executed, code: "verification" });
        return report("unverified", executed, `Model reported: ${said}`);
      }
      try {
        if (await syncInstructions()) continue;
        await host.onBeforeVerify?.(executed);
        const fresh = await host.capture();
        if (host.stopped()) return report("stopped", executed, `Stopped after ${executed} actions. The goal was not verified.`);
        const evidence = await host.verify(goal, fresh, said);
        if (await syncInstructions()) continue;
        if (host.stopped()) return report("stopped", executed, `Stopped after ${executed} actions. The goal was not verified.`);
        if (evidence && evidence.trim().length >= 12) {
          host.onTrace?.({ stage: "verified", step: executed });
          return report("verified", executed, said, evidence.trim().slice(0, 500));
        }
        // Give the existing Computer Use loop one evidence-gathering chance instead
        // of treating a plausible but unsupported completion claim as the end.
        // Start with a fresh screenshot and interaction. Never automatically
        // repeat an uncertain save, click, or submission.
        if (executed > 0 && !verificationRetried && step + 1 < limits.maxSteps) {
          verificationRetried = true;
          verificationFeedback = "A fresh independent check could not verify your completion claim. " +
            "Inspect current state before taking further action. Do not repeat uncertain side effects. " +
            "For a file save/edit, reopen the exact file from disk and check its contents. " +
            "Only claim completion after evidence of the requested end state.";
          previousId = null;
          result = null;
          selectedModel = undefined;
          continue;
        }
        host.onTrace?.({ stage: "unverified", step: executed, code: "verification" });
        return report("unverified", executed, `Model reported: ${said}. Fresh-screen verification did not confirm the goal.`);
      } catch {
        host.onTrace?.({ stage: "unverified", step: executed, code: "verification" });
        return report("unverified", executed, `Model reported: ${said}. Final screen verification was unavailable.`);
      }
    }
    if (interaction.call) verificationFeedback = null;
    if (!interaction.id || !interaction.callId) {
      host.onTrace?.({ stage: "blocked", step: executed, code: "model" });
      return report("blocked", executed, "Computer Use returned an action without its interaction or call ID. No action was executed.");
    }
    const decision = planComputerStep(interaction.call, step, startedAt, host.now(), host.stopped(), limits);
    if (decision.action === "stop") {
      host.onTrace?.({ stage: "blocked", step: executed, code: "tool" });
      return report("blocked", executed, decision.message);
    }
    let acknowledgement = false;
    if (decision.action === "confirm") {
      const allowed = await host.confirm(decision.explanation);
      if (!allowed || host.stopped()) {
        return report("stopped", executed, `Stopped after ${executed} actions because confirmation was declined or the task was cancelled.`);
      }
      acknowledgement = true;
    }
    // A phone redirect or pause after model reasoning invalidates the stale proposal.
    if (await syncInstructions()) continue;
    let outcome: string;
    try {
      await host.onBeforeAction?.(executed, decision.call.name);
      outcome = await host.execute(decision.call, image);
    }
    catch (error) {
      host.onTrace?.({ stage: "failed", step: executed, action: decision.call.name, code: "tool" });
      throw new ComputerTaskFailure("tool", error);
    }
    executed += 1;
    host.onTrace?.({ stage: "acted", step: executed, action: decision.call.name });
    try { await host.onProgress?.(executed, decision.call.name); }
    catch (error) {
      // The action already happened. Never replay it after checkpoint failure.
      host.onTrace?.({ stage: "failed", step: executed, action: decision.call.name, code: "tool" });
      throw new ComputerTaskFailure("tool", error);
    }
    if (host.stopped()) return report("stopped", executed, `Stopped after ${executed} actions. The goal was not verified.`);
    previousId = interaction.id;
    result = { name: decision.call.name, callId: interaction.callId, result: outcome, acknowledgement, imageBase64: null };
  }
  host.onTrace?.({ stage: "blocked", step: executed });
  return report("blocked", executed, `Step limit reached after ${executed} actions. The goal was not verified.`);
}

/** Existing local Assistant tooling expects text; include the actual verification state. */
export async function runComputerTask(
  goal: string,
  host: ComputerTaskHost,
  limits?: ComputerTaskLimits,
): Promise<string> {
  const outcome = await runComputerTaskReport(goal, host, limits);
  return `${outcome.status.toUpperCase()}: ${outcome.summary}${outcome.evidence ? ` Evidence: ${outcome.evidence}` : ""}`;
}
