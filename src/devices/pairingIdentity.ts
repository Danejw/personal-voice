/** A non-exportable per-install signing identity. Transport in PR 2 will use it for peer proof.
 * IndexedDB stores CryptoKey handles, not serialized private-key bytes. Native OS keystore
 * integration remains a security gate before PR 36 can be marked ready to merge. */
export interface PublicPairingKey {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

interface StoredIdentity { id: string; pair: CryptoKeyPair }
const DB_NAME = "personal-voice-pairing-keys";
const STORE = "identities";
const active = new Map<string, Promise<CryptoKeyPair>>();

function openKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Secure pairing storage is unavailable."));
  });
}

async function readKey(id: string): Promise<CryptoKeyPair | null> {
  const db = await openKeyDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
      request.onsuccess = () => resolve((request.result as StoredIdentity | undefined)?.pair ?? null);
      request.onerror = () => reject(new Error("Unable to read this device's pairing identity."));
    });
  } finally { db.close(); }
}

async function writeKey(id: string, pair: CryptoKeyPair): Promise<void> {
  const db = await openKeyDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put({ id, pair } satisfies StoredIdentity);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error("Unable to save this device's pairing identity."));
      transaction.onabort = () => reject(new Error("Unable to save this device's pairing identity."));
    });
  } finally { db.close(); }
}

export function pairingIdentity(deviceId: string): Promise<CryptoKeyPair> {
  const previous = active.get(deviceId);
  if (previous) return previous;
  const task = (async () => {
    const stored = await readKey(deviceId);
    if (stored) return stored;
    const generated = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"],
    );
    await writeKey(deviceId, generated);
    return generated;
  })();
  active.set(deviceId, task);
  void task.catch(() => { if (active.get(deviceId) === task) active.delete(deviceId); });
  return task;
}

export function publicKeyFromJwk(value: unknown): PublicPairingKey | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.kty !== "EC" || row.crv !== "P-256") return null;
  if (typeof row.x !== "string" || typeof row.y !== "string"
    || !/^[A-Za-z0-9_-]{43}$/.test(row.x) || !/^[A-Za-z0-9_-]{43}$/.test(row.y)) return null;
  return { kty: "EC", crv: "P-256", x: row.x, y: row.y };
}

export async function publicPairingKey(pair: CryptoKeyPair): Promise<PublicPairingKey> {
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const value = publicKeyFromJwk(jwk);
  if (!value) throw new Error("Device public key was invalid.");
  return value;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeBase64Url(encoded: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("Invalid pairing signature.");
  const raw = atob(encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "="));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}
export function pairingClaimText(code: string, claimantDeviceId: string): string {
  return `personal-voice:claim:v1:${code}:${claimantDeviceId}`;
}
export function pairingApprovalText(
  inviteId: string, issuerDeviceId: string, claimantDeviceId: string, claimantKey: PublicPairingKey,
): string {
  return `personal-voice:approve:v1:${inviteId}:${issuerDeviceId}:${claimantDeviceId}:${claimantKey.x}:${claimantKey.y}`;
}

export async function signPairingText(pair: CryptoKeyPair, message: string): Promise<string> {
  const bytes = new TextEncoder().encode(message);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, bytes);
  return encodeBase64Url(new Uint8Array(signature));
}

export async function verifyPairingText(publicKey: PublicPairingKey, message: string, proof: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "jwk", { ...publicKey, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
    );
    const signature = decodeBase64Url(proof);
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, key, signature as BufferSource, new TextEncoder().encode(message),
    );
  } catch { return false; }
}

export function keysMatch(a: PublicPairingKey, b: PublicPairingKey): boolean {
  return a.x === b.x && a.y === b.y;
}
