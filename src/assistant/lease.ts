/** How long a claim lasts. The holder renews before this. The server clamps the same range. */
export const ASSISTANT_LEASE_TTL_SECONDS = 45;
export const ASSISTANT_LEASE_RENEW_MS = 20_000;

/** True when this device still owns an unexpired lease. The server clock is what append checks. */
export function leaseIsCurrent(input: {
  leaseDeviceId: string | null;
  leaseExpiresAt: string | null;
  deviceId: string;
  now: number;
}): boolean {
  if (!input.leaseDeviceId || input.leaseDeviceId !== input.deviceId || !input.leaseExpiresAt) return false;
  const expires = Date.parse(input.leaseExpiresAt);
  return Number.isFinite(expires) && expires > input.now;
}
