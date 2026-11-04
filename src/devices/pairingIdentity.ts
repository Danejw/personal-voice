import { invoke } from "@tauri-apps/api/core";
import { callPlugin } from "@/platform/android/voicePlatformPlugin";

/** Public P-256 identity. The private key stays in Windows CNG or Android Keystore. */
export interface PublicPairingKey {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

function android(): boolean {
  return typeof navigator !== "undefined" && /\bAndroid\b/.test(navigator.userAgent);
}

export function publicKeyFromJwk(value: unknown): PublicPairingKey | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kty !== "EC" || row.crv !== "P-256") return null;
  if (typeof row.x !== "string" || typeof row.y !== "string"
    || !/^[A-Za-z0-9_-]{43}$/.test(row.x) || !/^[A-Za-z0-9_-]{43}$/.test(row.y)) return null;
  return { kty: "EC", crv: "P-256", x: row.x, y: row.y };
}

export async function nativePairPublicKey(deviceId: string): Promise<PublicPairingKey> {
  const result: unknown = android()
    ? await callPlugin("pairing_public_key", { deviceId })
    : await invoke("pairing_public_key", { deviceId });
  const key = publicKeyFromJwk(result);
  if (!key) throw new Error("The native device signing key was invalid.");
  return key;
}

export async function nativeSignPairingText(deviceId: string, message: string): Promise<string> {
  const result: unknown = android()
    ? await callPlugin<{ signature: string }>("pairing_sign", { deviceId, message })
    : await invoke<string>("pairing_sign", { deviceId, message });
  const signature = typeof result === "string" ? result
    : typeof result === "object" && result !== null
      ? (result as Record<string, unknown>).signature : null;
  if (typeof signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(signature)) {
    throw new Error("Invalid native device signature.");
  }
  return signature;
}

export function pairingClaimText(code: string, claimantDeviceId: string): string {
  return `personal-voice:claim:v1:${code}:${claimantDeviceId}`;
}
export function pairingApprovalText(
  inviteId: string, issuerDeviceId: string, claimantDeviceId: string, claimantKey: PublicPairingKey,
): string {
  return `personal-voice:approve:v1:${inviteId}:${issuerDeviceId}:${claimantDeviceId}:${claimantKey.x}:${claimantKey.y}`;
}

function decodeBase64Url(encoded: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("Invalid pairing signature.");
  const raw = atob(encoded.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(encoded.length / 4) * 4, "="));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export async function verifyPairingText(key: PublicPairingKey, message: string, proof: string): Promise<boolean> {
  try {
    if (!/^[A-Za-z0-9_-]{86}$/.test(proof)) return false;
    const imported = await crypto.subtle.importKey("jwk", { ...key, ext: true },
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" },
      imported, decodeBase64Url(proof) as BufferSource, new TextEncoder().encode(message));
  } catch { return false; }
}

export function keysMatch(a: PublicPairingKey, b: PublicPairingKey): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Stable JSON field order for signed server requests. Both sides encode the exact same bytes. */
export function deviceProofPayload(
  op: string, deviceId: string, nonce: string, issuedAt: number, args: Record<string, unknown>,
): string {
  return JSON.stringify({ v: 1, op, deviceId, nonce, issuedAt, args });
}
