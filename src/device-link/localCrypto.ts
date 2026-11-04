import type { PublicPairingKey } from "@/devices/pairingIdentity";
import { verifyPairingText } from "@/devices/pairingIdentity";
import {
  DEVICE_LINK_MAX_FRAME_BYTES, parseDeviceLinkEnvelope, type DeviceLinkEnvelope,
} from "@/device-link/protocol";

/** The relay only sees these signed hellos and encrypted frames, never command contents. */
export interface LocalHello {
  v: 1;
  kind: "hello";
  from: string;
  target: string;
  sessionId: string;
  sentAt: number;
  ephemeralKey: PublicPairingKey;
  signature: string;
}
export interface EncryptedWireFrame {
  v: 1;
  kind: "sealed";
  from: string;
  target: string;
  seq: number;
  iv: string;
  body: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const base64url = (data: Uint8Array): string => {
  let value = "";
  for (const byte of data) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const decode64 = (data: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]+$/.test(data)) throw new Error("Invalid encrypted frame.");
  const value = atob(data.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(data.length / 4) * 4, "="));
  return Uint8Array.from(value, c => c.charCodeAt(0));
};
function publicKey(value: unknown): PublicPairingKey | null {
  if (!value || typeof value !== "object") return null;
  const x = value as Record<string, unknown>;
  if (x.kty !== "EC" || x.crv !== "P-256"
    || typeof x.x !== "string" || typeof x.y !== "string"
    || !/^[A-Za-z0-9_-]{43}$/.test(x.x) || !/^[A-Za-z0-9_-]{43}$/.test(x.y)) return null;
  return { kty: "EC", crv: "P-256", x: x.x, y: x.y };
}
export function localHelloText(message: Omit<LocalHello, "signature">): string {
  return "personal-voice:device-link:hello:v1:" + JSON.stringify([
    message.from, message.target, message.sessionId, message.sentAt,
    message.ephemeralKey.x, message.ephemeralKey.y,
  ]);
}

export async function startLocalHandshake(
  from: string, target: string, sign: (message: string) => Promise<string>,
  now = Date.now(),
): Promise<{ hello: LocalHello; secret: CryptoKeyPair }> {
  if (!uuid.test(from) || !uuid.test(target) || from === target) throw new Error("Invalid device IDs.");
  const secret = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const key = publicKey(await crypto.subtle.exportKey("jwk", secret.publicKey));
  if (!key) throw new Error("Failed to generate an ephemeral ECDH key.");
  const helloPayload: Omit<LocalHello, "signature"> = {
    v: 1, kind: "hello", from, target, sessionId: crypto.randomUUID(), sentAt: now, ephemeralKey: key,
  };
  return { secret, hello: { ...helloPayload, signature: await sign(localHelloText(helloPayload)) } };
}

export async function verifyLocalHello(
  value: unknown, expectedFrom: string, expectedTarget: string,
  identity: PublicPairingKey, now = Date.now(),
): Promise<LocalHello | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(",") !== "ephemeralKey,from,kind,sentAt,sessionId,signature,target,v"
    || v.v !== 1 || v.kind !== "hello" || v.from !== expectedFrom || v.target !== expectedTarget
    || !uuid.test(String(v.sessionId)) || !Number.isSafeInteger(v.sentAt)
    || Math.abs(now - (v.sentAt as number)) > 30_000
    || !publicKey(v.ephemeralKey) || typeof v.signature !== "string") return null;
  const hello = value as LocalHello;
  return await verifyPairingText(identity, localHelloText(hello), hello.signature) ? hello : null;
}

export async function sharedLocalSessionKey(
  ours: CryptoKeyPair, ownHello: LocalHello, theirs: LocalHello,
): Promise<CryptoKey> {
  if (ownHello.from !== theirs.target || ownHello.target !== theirs.from) {
    throw new Error("DeviceLink handshake participants differ.");
  }
  const peer = await crypto.subtle.importKey(
    "jwk", { ...theirs.ephemeralKey, ext: true },
    { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, ours.privateKey, 256);
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  const sessions = [ownHello.sessionId, theirs.sessionId].sort().join(":");
  const parties = [ownHello.from, theirs.from].sort().join(":");
  const salt = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessions));
  return crypto.subtle.deriveKey({
    name: "HKDF", hash: "SHA-256", salt,
    info: new TextEncoder().encode("personal-voice:device-link:v1:" + parties),
  }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export class LocalCipher {
  private sendSequence = 0;
  private lastReceived = 0;
  private readonly prefix = crypto.getRandomValues(new Uint8Array(4));

  constructor(private key: CryptoKey, private localId: string, private remoteId: string) {}

  async seal(frame: DeviceLinkEnvelope): Promise<EncryptedWireFrame> {
    if (frame.sender !== this.localId || frame.target !== this.remoteId) throw new Error("Wrong frame recipient.");
    const seq = ++this.sendSequence;
    const iv = new Uint8Array(12);
    iv.set(this.prefix);
    new DataView(iv.buffer).setBigUint64(4, BigInt(seq));
    const aad = new TextEncoder().encode(`1:${this.localId}:${this.remoteId}:${seq}`);
    const ciphertext = await crypto.subtle.encrypt({
      name: "AES-GCM", iv, additionalData: aad,
    }, this.key, new TextEncoder().encode(JSON.stringify(frame)));
    return { v: 1, kind: "sealed", from: this.localId, target: this.remoteId,
      seq, iv: base64url(iv), body: base64url(new Uint8Array(ciphertext)) };
  }

  async open(value: unknown, now = Date.now()): Promise<DeviceLinkEnvelope | null> {
    if (!value || typeof value !== "object") return null;
    const v = value as Record<string, unknown>;
    if (Object.keys(v).sort().join(",") !== "body,from,iv,kind,seq,target,v"
      || v.v !== 1 || v.kind !== "sealed" || v.from !== this.remoteId || v.target !== this.localId
      || !Number.isSafeInteger(v.seq) || (v.seq as number) <= this.lastReceived
      || typeof v.iv !== "string" || typeof v.body !== "string"
      || v.body.length > DEVICE_LINK_MAX_FRAME_BYTES * 2) return null;
    try {
      const iv = decode64(v.iv);
      if (iv.length !== 12 || decode64(v.body).length > DEVICE_LINK_MAX_FRAME_BYTES) return null;
      const aad = new TextEncoder().encode(`1:${v.from}:${v.target}:${v.seq}`);
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad }, this.key, decode64(v.body) as BufferSource,
      );
      const frame = parseDeviceLinkEnvelope(JSON.parse(new TextDecoder().decode(plaintext)), now);
      if (!frame || frame.sender !== this.remoteId || frame.target !== this.localId) return null;
      this.lastReceived = v.seq as number;
      return frame;
    } catch { return null; }
  }
}
