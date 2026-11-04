import { getSupabase } from "@/services/supabase";
import {
  nativePairPublicKey, nativeSignPairingText, pairingClaimText, pairingApprovalText,
  deviceProofPayload, verifyPairingText, publicKeyFromJwk, keysMatch,
  type PublicPairingKey,
} from "@/devices/pairingIdentity";

export interface PairInvite {
  id: string;
  status: "open" | "claimed" | "approved" | "cancelled";
  issuerDeviceId: string;
  claimantDeviceId: string | null;
  expiresAt: string;
  issuerKey: PublicPairingKey;
  claimantKey: PublicPairingKey | null;
  claimSignature: string | null;
  approvalSignature: string | null;
}
export interface PairLink { id: string; peerDeviceId: string; createdAt: string }
export interface PairCode { id: string; code: string; expiresAt: string }

function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid pairing response.");
  return value as Record<string, unknown>;
}
function str(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Invalid pairing response.");
  return value;
}
function optional(value: unknown): string | null { return typeof value === "string" ? value : null; }
function parseInvite(data: unknown): PairInvite {
  const value = row(data);
  const status = value.status;
  if (status !== "open" && status !== "claimed" && status !== "approved" && status !== "cancelled") {
    throw new Error("Invalid pairing status.");
  }
  const issuerKey = publicKeyFromJwk(value.issuer_key);
  if (!issuerKey) throw new Error("Invalid peer identity.");
  return {
    id: str(value.id), status, issuerDeviceId: str(value.issuer_device_id),
    claimantDeviceId: optional(value.claimant_device_id), expiresAt: str(value.expires_at),
    issuerKey, claimantKey: publicKeyFromJwk(value.claimant_key),
    claimSignature: optional(value.claim_signature), approvalSignature: optional(value.approval_signature),
  };
}

/** All database operations are authorized by the Edge Function, never direct RPC access.
 * Each native signature covers the exact payload, a timestamp and a one-use nonce. */
export async function pairServerAction<T>(
  deviceId: string, op: string, args: Record<string, unknown> = {},
): Promise<T> {
  const client = getSupabase();
  if (!client) throw new Error("Device pairing requires account sync.");
  const payload = deviceProofPayload(op, deviceId, crypto.randomUUID(), Date.now(), args);
  const signature = await nativeSignPairingText(deviceId, payload);
  const { data, error } = await client.functions.invoke<{ data?: T; error?: string }>(
    "device-pairing", { body: { payload, signature } },
  );
  let failure = data?.error;
  if (error && "context" in error && error.context instanceof Response) {
    try {
      const body = await error.context.json() as { error?: unknown };
      if (typeof body.error === "string") failure = body.error;
    } catch { /* Network errors have no response body. */ }
  }
  if (error || failure) {
    if (failure === "rate_limited") throw new Error("Too many pairing attempts. Try again later.");
    if (failure === "invalid") throw new Error("Pairing code is incorrect or has expired.");
    if (failure === "device" || failure === "identity" || failure === "proof") {
      throw new Error("This device could not prove its identity. Re-register the device if its keys changed.");
    }
    if (failure === "replay") throw new Error("Pairing request was already processed.");
    throw new Error("Device pairing is unavailable or the request was rejected.");
  }
  if (!data || !("data" in data)) throw new Error("Invalid pairing response.");
  return data.data as T;
}

export const devicePairingApi = {
  async register(deviceId: string): Promise<void> {
    const publicJwk = await nativePairPublicKey(deviceId);
    const result = await pairServerAction<boolean>(deviceId, "register", {
      publicJwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
    });
    if (result !== true) throw new Error("Could not register pairing identity.");
  },
  async invite(deviceId: string): Promise<PairCode> {
    await this.register(deviceId);
    const result = row(await pairServerAction<unknown>(deviceId, "invite"));
    const code = str(result.code);
    if (!/^[0-9]{8}$/.test(code)) throw new Error("Invalid pairing code.");
    return { id: str(result.id), code, expiresAt: str(result.expires_at) };
  },
  async claim(deviceId: string, input: string): Promise<string> {
    const code = input.replace(/[\s-]/g, "");
    if (!/^[0-9]{8}$/.test(code)) throw new Error("Enter the 8-digit pairing code.");
    await this.register(deviceId);
    const claimSignature = await nativeSignPairingText(deviceId, pairingClaimText(code, deviceId));
    const result = row(await pairServerAction<unknown>(deviceId, "claim", { code, claimSignature }));
    return str(result.id);
  },
  async read(deviceId: string, id: string): Promise<PairInvite | null> {
    const data = await pairServerAction<unknown>(deviceId, "read", { id });
    return data ? parseInvite(data) : null;
  },
  async approve(deviceId: string, invite: PairInvite, code: string): Promise<void> {
    if (invite.status !== "claimed" || invite.issuerDeviceId !== deviceId ||
      !invite.claimantDeviceId || !invite.claimantKey || !invite.claimSignature) {
      throw new Error("No device is ready for approval.");
    }
    if (Date.parse(invite.expiresAt) <= Date.now()) throw new Error("Pairing code expired.");
    if (!await verifyPairingText(invite.claimantKey,
      pairingClaimText(code, invite.claimantDeviceId), invite.claimSignature)) {
      throw new Error("Joining device identity could not be verified.");
    }
    const current = await nativePairPublicKey(deviceId);
    if (!keysMatch(current, invite.issuerKey)) throw new Error("This device identity has changed.");
    const approvalSignature = await nativeSignPairingText(deviceId, pairingApprovalText(
      invite.id, deviceId, invite.claimantDeviceId, invite.claimantKey,
    ));
    const result = await pairServerAction<boolean>(deviceId, "approve", {
      id: invite.id, approvalSignature,
    });
    if (result !== true) throw new Error("Pairing invitation is no longer available.");
  },
  async cancel(deviceId: string, id: string): Promise<void> {
    await pairServerAction<boolean>(deviceId, "cancel", { id });
  },
  async revoke(deviceId: string, id: string): Promise<void> {
    const result = await pairServerAction<boolean>(deviceId, "revoke", { linkId: id });
    if (result !== true) throw new Error("Pairing was already removed.");
  },
};
