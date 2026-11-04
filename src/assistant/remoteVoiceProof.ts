import { nativeSignPairingText, verifyPairingText, type PublicPairingKey } from "@/devices/pairingIdentity";
import { verifiedPairLinks } from "@/services/verifiedPairLinks";

export type RemoteVoiceFamily = "action" | "read";
export type RemoteVoiceState = "answered" | "denied";
export const REMOTE_VOICE_VERSION = 2;
export const REMOTE_VOICE_EXPIRY_MS = 30_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

export interface SignedRemoteRequest {
  id: string;
  requesterDeviceId: string;
  targetDeviceId: string;
  version: number;
  expiresAt: string;
  requestSignature: string | null;
}

export interface SignedRemoteResponse {
  status: RemoteVoiceState | "pending";
  resultText: string | null;
  responseSignature: string | null;
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return btoa(String.fromCharCode(...digest))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function remoteRequestProofText(
  family: RemoteVoiceFamily, id: string, requester: string, target: string,
  kind: string, argument: string,
): Promise<string> {
  return `personal-voice:remote:v2:req:${family}:${id}:${requester}:${target}:${await sha256(JSON.stringify([kind, argument]))}`;
}

export async function remoteResponseProofText(
  family: RemoteVoiceFamily, id: string, requester: string, target: string,
  status: RemoteVoiceState, result: string,
): Promise<string> {
  return `personal-voice:remote:v2:result:${family}:${id}:${requester}:${target}:${status}:${await sha256(result)}`;
}

export async function signRemoteRequest(
  family: RemoteVoiceFamily, id: string, requester: string, target: string,
  kind: string, argument = "",
): Promise<string> {
  return nativeSignPairingText(requester, await remoteRequestProofText(
    family, id, requester, target, kind, argument,
  ));
}
export async function signRemoteResponse(
  family: RemoteVoiceFamily, row: SignedRemoteRequest,
  status: RemoteVoiceState, result: string,
): Promise<string> {
  return nativeSignPairingText(row.targetDeviceId, await remoteResponseProofText(
    family, row.id, row.requesterDeviceId, row.targetDeviceId, status, result,
  ));
}

/** Membership is based on PR36's cryptographically validated pair links, not
 * merely the list of devices registered under the same Supabase account. */
export async function pairedPublicKey(localId: string, peerId: string): Promise<PublicPairingKey> {
  if (!UUID.test(localId) || !UUID.test(peerId) || localId === peerId) {
    throw new Error("Specify a different paired device.");
  }
  const links = await verifiedPairLinks(localId);
  const trusted = links.find(link => link.peerDeviceId === peerId);
  if (!trusted?.peerPublicKey) throw new Error("That device isn't paired or its pairing has been revoked.");
  return trusted.peerPublicKey;
}

export async function verifyRemoteRequest(
  family: RemoteVoiceFamily,
  row: SignedRemoteRequest, kind: string, argument = "",
): Promise<boolean> {
  if (row.version !== REMOTE_VOICE_VERSION || !row.requestSignature ||
    !UUID.test(row.id) || !UUID.test(row.requesterDeviceId) || !UUID.test(row.targetDeviceId) ||
    !Number.isFinite(Date.parse(row.expiresAt)) || Date.parse(row.expiresAt) <= Date.now()) return false;
  try {
    const requesterKey = await pairedPublicKey(row.targetDeviceId, row.requesterDeviceId);
    return await verifyPairingText(requesterKey, await remoteRequestProofText(
      family, row.id, row.requesterDeviceId, row.targetDeviceId, kind, argument,
    ), row.requestSignature);
  } catch { return false; }
}

export async function verifyRemoteResponse(
  family: RemoteVoiceFamily, row: SignedRemoteRequest & SignedRemoteResponse,
): Promise<boolean> {
  if (row.status !== "answered" && row.status !== "denied") return false;
  if (row.version !== REMOTE_VOICE_VERSION || !row.responseSignature || row.resultText === null
    || Date.parse(row.expiresAt) <= Date.now()) return false;
  try {
    const targetKey = await pairedPublicKey(row.requesterDeviceId, row.targetDeviceId);
    return await verifyPairingText(targetKey, await remoteResponseProofText(
      family, row.id, row.requesterDeviceId, row.targetDeviceId, row.status, row.resultText,
    ), row.responseSignature);
  } catch { return false; }
}
