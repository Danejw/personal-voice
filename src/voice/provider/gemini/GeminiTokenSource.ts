/** A short-lived Gemini Live credential. Each token opens exactly one session (`uses: 1`). */
export interface GeminiToken {
  token: string;
  /** Epoch ms after which Gemini rejects new sessions opened with this token. */
  newSessionExpiresAt: number;
}

/** A credential failure; `retryable: false` means trying again cannot help (signed out, not allowed). */
export class CredentialError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "CredentialError";
  }
}

/** A cached token is only handed out if a session can still start comfortably before its window closes. */
const SAFETY_MARGIN_MS = 15_000;

/**
 * Hands out single-use tokens and keeps at most one unused token warm, so a press
 * rarely waits on the token round trip. Tokens live only in memory.
 */
export class GeminiTokenSource {
  private next?: Promise<GeminiToken>;

  constructor(
    private fetchToken: () => Promise<GeminiToken>,
    private now: () => number = Date.now,
  ) {}

  /** Returns an unused token and starts fetching its replacement. */
  async take(): Promise<string> {
    const pending = this.next;
    this.next = undefined;
    const cached = pending ? await pending.catch(() => undefined) : undefined;
    const token = cached && cached.newSessionExpiresAt - SAFETY_MARGIN_MS > this.now() ? cached : await this.fetchToken();
    this.prefetch();
    return token.token;
  }

  prefetch(): void {
    if (this.next) return;
    const next = this.fetchToken();
    next.catch(() => undefined);
    this.next = next;
  }

  /** Drops any cached token, e.g. on sign-out. */
  clear(): void {
    this.next = undefined;
  }
}
