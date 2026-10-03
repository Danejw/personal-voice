/** Tap vs hold threshold for the Remote Dictation control. */
export const REMOTE_DICTATION_HOLD_MS = 300;

/** Freshness window for an immediate cursor paste. Past this, refuse claim/insert. */
export const REMOTE_DICTATION_EXPIRE_MS = 6_000;

/** Sender waits a little past expiry so the receiver can finish an in-flight claim. */
export const REMOTE_DICTATION_SENDER_WAIT_MS = REMOTE_DICTATION_EXPIRE_MS + 2_000;

/** Reuse the account's remote-device presence window (45s). */
export { REMOTE_ONLINE_MS as REMOTE_DICTATION_ONLINE_MS } from "@/assistant/remoteContext";

/** How often the signed-in device refreshes last_seen for Remote Dictation presence. */
export const REMOTE_DICTATION_HEARTBEAT_MS = 15_000;

/** Missed Realtime catch-up interval. Not the primary delivery path. */
export const REMOTE_DICTATION_CATCHUP_MS = 4_000;

export const REMOTE_DICTATION_TEXT_LIMIT = 100_000;
