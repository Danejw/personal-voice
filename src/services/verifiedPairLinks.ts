import {
  nativePairPublicKey, publicKeyFromJwk,
  keysMatch, verifyPairingText, pairingApprovalText,
} from "@/devices/pairingIdentity";
import { pairServerAction, type PairInvite, type PairLink } from "@/services/devicePairingService";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid paired device.");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Invalid paired device.");
  return value;
}

/** Proof of approval binds both device IDs and the claimant's public key. */
export async function verifyPairApproval(deviceId: string, invite: PairInvite): Promise<boolean> {
  if (invite.status !== "approved" || !invite.claimantDeviceId ||
      !invite.claimantKey || !invite.approvalSignature) return false;
  const local = await nativePairPublicKey(deviceId);
  const mine = invite.issuerDeviceId === deviceId ? invite.issuerKey
    : invite.claimantDeviceId === deviceId ? invite.claimantKey : null;
  if (!mine || !keysMatch(local, mine)) return false;
  return verifyPairingText(invite.issuerKey, pairingApprovalText(
    invite.id, invite.issuerDeviceId, invite.claimantDeviceId, invite.claimantKey,
  ), invite.approvalSignature);
}

/** Only cryptographically verified approvals count as paired on this device. */
export async function verifiedPairLinks(deviceId: string): Promise<PairLink[]> {
  const data = await pairServerAction<unknown>(deviceId, "list");
  if (!Array.isArray(data)) throw new Error("Invalid pairing list.");
  const mine = await nativePairPublicKey(deviceId);
  const result: PairLink[] = [];
  for (const item of data) {
    try {
      const value = object(item);
      const issuerKey = publicKeyFromJwk(value.issuer_key);
      const claimantKey = publicKeyFromJwk(value.claimant_key);
      if (!issuerKey || !claimantKey) continue;
      const issuerId = string(value.issuer_device_id);
      const claimantId = string(value.claimant_device_id);
      const localKey = issuerId === deviceId ? issuerKey
        : claimantId === deviceId ? claimantKey : null;
      if (!localKey || !keysMatch(mine, localKey)) continue;
      const valid = await verifyPairingText(issuerKey, pairingApprovalText(
        string(value.invite_id), issuerId, claimantId, claimantKey,
      ), string(value.approval_signature));
      if (valid) result.push({
        id: string(value.id), peerDeviceId: string(value.peer_device_id),
        createdAt: string(value.created_at),
        peerPublicKey: issuerId === deviceId ? claimantKey : issuerKey,
      });
    } catch { /* An invalid proof is not a trusted pairing. */ }
  }
  return result;
}
