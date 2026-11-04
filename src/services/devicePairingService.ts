import { getSupabase } from "@/services/supabase";
import {
  pairingIdentity, publicPairingKey, pairingClaimText, pairingApprovalText,
  signPairingText, verifyPairingText, publicKeyFromJwk, keysMatch,
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

function db() {
  const client = getSupabase();
  if (!client) throw new Error("Device pairing requires account sync.");
  return client;
}
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid pairing response.");
  return value as Record<string, unknown>;
}
function str(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Invalid pairing response.");
  return value;
}
function optional(value: unknown): string | null { return typeof value === "string" ? value : null; }
function check(error: { message: string } | null): void {
  if (!error) return;
  if (error.message.includes("PAIR_TRY_LATER") || error.message.includes("PAIR_INVITE_LIMIT")) {
    throw new Error("Pairing temporarily limited. Try again later.");
  }
  if (error.message.includes("PAIR_KEY_CHANGED")) throw new Error("Device identity has changed. Remove the old device registration.");
  if (error.message.includes("PAIR_INVALID") || error.message.includes("PAIR_SELF")) {
    throw new Error("Invalid or expired pairing code.");
  }
  throw new Error("Device pairing failed. Check the connection and device registration.");
}
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

export const devicePairingApi = {
  async register(deviceId: string) {
    const key = await publicPairingKey(await pairingIdentity(deviceId));
    const { data, error } = await db().rpc("pair_register_identity", {
      p_device_id: deviceId, p_public_jwk: key,
    });
    check(error);
    if (data !== true) throw new Error("Pairing identity could not be registered.");
  },
  async invite(deviceId: string): Promise<PairCode> {
    await this.register(deviceId);
    const { data, error } = await db().rpc("pair_create_invite", { p_device_id: deviceId });
    check(error);
    const result = row(data);
    return { id: str(result.id), code: str(result.code), expiresAt: str(result.expires_at) };
  },
  async claim(deviceId: string, input: string): Promise<string> {
    const code = input.replace(/[\s-]/g, "");
    if (!/^[0-9]{8}$/.test(code)) throw new Error("Enter an 8-digit pairing code.");
    await this.register(deviceId);
    const proof = await signPairingText(await pairingIdentity(deviceId), pairingClaimText(code, deviceId));
    const { data, error } = await db().rpc("pair_claim_invite", {
      p_device_id: deviceId, p_code: code, p_signature: proof,
    });
    check(error);
    return str(row(data).id);
  },
  async read(deviceId: string, id: string): Promise<PairInvite | null> {
    const { data, error } = await db().rpc("pair_get_invite", { p_id: id, p_device_id: deviceId });
    check(error);
    return data ? parseInvite(data) : null;
  },
  async approve(deviceId: string, invite: PairInvite, code: string): Promise<void> {
    if (invite.status !== "claimed" || invite.issuerDeviceId !== deviceId ||
      !invite.claimantDeviceId || !invite.claimantKey || !invite.claimSignature) {
      throw new Error("No device is ready for approval.");
    }
    if (Date.parse(invite.expiresAt) <= Date.now()) throw new Error("Pairing code expired.");
    if (!await verifyPairingText(invite.claimantKey, pairingClaimText(code, invite.claimantDeviceId), invite.claimSignature)) {
      throw new Error("Joining device identity could not be verified.");
    }
    const identity = await pairingIdentity(deviceId);
    if (!keysMatch(await publicPairingKey(identity), invite.issuerKey)) {
      throw new Error("This device's identity does not match.");
    }
    const signature = await signPairingText(identity, pairingApprovalText(
      invite.id, deviceId, invite.claimantDeviceId, invite.claimantKey,
    ));
    const { data, error } = await db().rpc("pair_approve_invite", {
      p_id: invite.id, p_device_id: deviceId, p_signature: signature,
    });
    check(error);
    if (data !== true) throw new Error("Pairing invitation is no longer available.");
  },
  async cancel(deviceId: string, id: string) {
    const { error } = await db().rpc("pair_cancel_invite", { p_id: id, p_device_id: deviceId });
    check(error);
  },
  async revoke(deviceId: string, id: string) {
    const { data, error } = await db().rpc("pair_revoke_link", { p_link_id: id, p_device_id: deviceId });
    check(error);
    if (data !== true) throw new Error("Pairing was already removed.");
  },
};
