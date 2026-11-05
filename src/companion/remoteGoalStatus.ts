/** Display logic only. Never promote signed command acceptance to goal completion. */
export function remoteGoalStillActive(message: string): boolean {
  if (/^No Computer Use session has been started on this PC\./i.test(message)) return false;
  if (/^Computer Use goal accepted on Windows\./i.test(message)) return true;
  const match = /^Computer Use (?:job [^:]+: )?(starting|running|stopping|stopped|completed|failed|interrupted|needs_review|blocked)\b/i.exec(message);
  // Unknown remote receipts are not a reason to keep polling indefinitely.
  return match ? ["starting", "running", "stopping"].includes((match[1] ?? "").toLowerCase()) : false;
}
