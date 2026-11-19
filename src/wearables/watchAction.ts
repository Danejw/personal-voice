export type AssistantWatchStatus = "IDLE" | "CONNECTING" | "READY" | "RESPONDING" | "ERROR";
export type WatchTapResult = "started" | "stopped" | "blocked" | "busy";
export interface WatchTapContext {
  signedIn: boolean;
  dictationBusy: boolean;
  status: AssistantWatchStatus;
}

/** Reuses Personal Voice's existing conversation lease and assistant lifecycle. */
export class WatchTapRouter {
  private starting = false;

  async handle(
    context: WatchTapContext,
    start: () => Promise<void>,
    stop: () => void,
  ): Promise<WatchTapResult> {
    if (!context.signedIn) return "blocked";
    if (this.starting) return "busy";
    if (context.status === "CONNECTING" || context.status === "READY" ||
        context.status === "RESPONDING") {
      stop();
      return "stopped";
    }
    if (context.dictationBusy) return "blocked";
    this.starting = true;
    try {
      await start();
      return "started";
    } finally {
      this.starting = false;
    }
  }
}
