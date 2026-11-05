import {
  parseInteraction,
  planComputerStep,
  type ComputerCall,
} from "@/assistant/computerActions";

export interface ComputerImage {
  jpeg: string;
  width: number;
  height: number;
}

export interface ComputerTaskHost {
  now(): number;
  stopped(): boolean;
  capture(): Promise<ComputerImage>;
  propose(body: Record<string, unknown>): Promise<unknown>;
  execute(call: ComputerCall, image: ComputerImage): Promise<string>;
  confirm(explanation: string): Promise<boolean>;
  onProgress?(step: number, action: string): void;
}

export interface ComputerTaskLimits {
  maxSteps: number;
  maxDurationMs: number;
}

/** Remote sessions get a bounded longer horizon, while local defaults remain unchanged. */
export const REMOTE_COMPUTER_LIMITS: ComputerTaskLimits = {
  maxSteps: 240,
  maxDurationMs: 30 * 60 * 1000,
};

/**
 * Screenshot, one proposed action, execute, screenshot again.
 * Gemini 3.8 Live is not this loop. Stop and the step and time caps end it.
 */
export async function runComputerTask(goal: string, host: ComputerTaskHost, limits: ComputerTaskLimits = { maxSteps: 8, maxDurationMs: 45_000 }): Promise<string> {
  const startedAt = host.now();
  let previousId: string | null = null;
  let result: { name: string; result: string; acknowledgement: boolean; imageBase64: string | null } | null = null;
  let lastImage: ComputerImage | null = null;
  for (let step = 0; step < limits.maxSteps; step += 1) {
    if (host.stopped()) return "Stopped. Nothing further was done.";
    const image = await host.capture();
    lastImage = image;
    const interaction = parseInteraction(await host.propose({
      goal,
      image: previousId ? null : image.jpeg,
      previousInteractionId: previousId,
      functionResult: result
        ? { name: result.name, result: result.result, acknowledgement: result.acknowledgement, image: image.jpeg }
        : null,
    }));
    if (!interaction.call) {
      const said = interaction.text.trim();
      return said || "The screen task finished. The latest screen was checked.";
    }
    const decision = planComputerStep(interaction.call, step, startedAt, host.now(), host.stopped(), limits);
    if (decision.action === "stop") return decision.message;
    let acknowledgement = false;
    if (decision.action === "confirm") {
      const allowed = await host.confirm(decision.explanation);
      if (!allowed || host.stopped()) return "Stopped. Nothing further was done.";
      acknowledgement = true;
    }
    const outcome = await host.execute(decision.call, image);
    host.onProgress?.(step + 1, decision.call.name);
    if (host.stopped()) return "Stopped. Nothing further was done.";
    previousId = interaction.id;
    result = { name: decision.call.name, result: outcome, acknowledgement, imageBase64: null };
  }
  if (lastImage) await host.capture();
  return `Stopped after ${limits.maxSteps} steps. The latest screen was checked.`;
}
