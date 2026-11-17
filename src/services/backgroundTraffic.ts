/**
 * Shared traffic governor for best-effort background synchronization.
 * Never blocks explicit user actions or signed command execution.
 */
export class BackgroundTrafficBudget {
  private quietUntil = 0;
  private quotaFailures = 0;

  canPoll(now = Date.now()): boolean {
    return now >= this.quietUntil;
  }

  noteSuccess(now = Date.now()): void {
    // A concurrent successful request must never cancel an active quota backoff.
    if (now < this.quietUntil) return;
    this.quotaFailures = 0;
    this.quietUntil = 0;
  }

  noteFailure(error: unknown, now = Date.now()): void {
    const message = error instanceof Error ? error.message : String(error);
    if (/exceed_egress_quota|quota exceeded|HTTP 402|payment required|spend cap/i.test(message)) {
      this.quotaFailures = Math.min(this.quotaFailures + 1, 5);
      const delay = Math.min(3_600_000, 300_000 * 2 ** (this.quotaFailures - 1));
      this.quietUntil = Math.max(this.quietUntil, now + delay);
    } else if (/network|failed to fetch|timeout|connection refused|offline|\b50[0-9]\b|\b503\b/i.test(message)) {
      this.quietUntil = Math.max(this.quietUntil, now + 30_000);
    }
  }
}

/** One recent presence update is sufficient for all Personal Voice receiver loops. */
export class DeviceHeartbeatGate {
  private readonly lastSuccess = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly traffic: BackgroundTrafficBudget,
    private readonly minIntervalMs = 25_000,
    private readonly now: () => number = Date.now,
  ) {}

  touch(deviceId: string, write: () => Promise<void>): Promise<void> {
    if (!this.traffic.canPoll(this.now())) return Promise.resolve();
    const pending = this.inFlight.get(deviceId);
    if (pending) return pending;
    const last = this.lastSuccess.get(deviceId);
    if (last !== undefined && this.now() - last < this.minIntervalMs) return Promise.resolve();

    const task = write()
      .then(() => {
        this.lastSuccess.set(deviceId, this.now());
        this.traffic.noteSuccess(this.now());
      })
      .catch((error: unknown) => {
        this.traffic.noteFailure(error, this.now());
        throw error;
      })
      .finally(() => {
        this.inFlight.delete(deviceId);
      });
    this.inFlight.set(deviceId, task);
    return task;
  }
}

/** Used by background loops only; foreground user actions retain their own error handling. */
export const backgroundTraffic = new BackgroundTrafficBudget();
export const deviceHeartbeat = new DeviceHeartbeatGate(backgroundTraffic);
