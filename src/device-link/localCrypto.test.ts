import { describe, expect, it } from "vitest";
import {
  startLocalHandshake, verifyLocalHello, sharedLocalSessionKey, LocalCipher,
} from "@/device-link/localCrypto";
import { makeEnvelope } from "@/device-link/protocol";
import type { PublicPairingKey } from "@/devices/pairingIdentity";

const desktop = "00000000-0000-4000-8000-000000000001";
const phone = "00000000-0000-4000-8000-000000000002";

async function identity() {
  const key = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", key.publicKey);
  const publicKey: PublicPairingKey = {
    kty: "EC", crv: "P-256", x: jwk.x!, y: jwk.y!,
  };
  const sign = async (text: string): Promise<string> => {
    const sig = new Uint8Array(await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" }, key.privateKey, new TextEncoder().encode(text)));
    return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  return { sign, publicKey };
}

describe("DeviceLink local authenticated session", () => {
  it("derives the same AES-GCM session key on both devices and refuses replays", async () => {
    const a = await identity();
    const b = await identity();
    const now = Date.now();
    const first = await startLocalHandshake(desktop, phone, a.sign, now);
    const second = await startLocalHandshake(phone, desktop, b.sign, now);
    expect(await verifyLocalHello(first.hello, desktop, phone, a.publicKey, now)).toEqual(first.hello);
    expect(await verifyLocalHello(second.hello, phone, desktop, b.publicKey, now)).toEqual(second.hello);
    const aKey = await sharedLocalSessionKey(first.secret, first.hello, second.hello);
    const bKey = await sharedLocalSessionKey(second.secret, second.hello, first.hello);
    const tx = new LocalCipher(aKey, desktop, phone);
    const rx = new LocalCipher(bKey, phone, desktop);
    const envelope = makeEnvelope(desktop, phone, { type: "cursor", x: -300, y: 250 }, now);
    const encrypted = await tx.seal(envelope);
    expect(JSON.stringify(encrypted)).not.toContain("-300");
    expect(await rx.open(encrypted, now)).toEqual(envelope);
    expect(await rx.open(encrypted, now)).toBeNull();
    expect(await rx.open({ ...encrypted, target: desktop }, now)).toBeNull();
  });

  it("denies a forged signed hello or untrusted identity", async () => {
    const a = await identity();
    const b = await identity();
    const hello = (await startLocalHandshake(desktop, phone, a.sign)).hello;
    expect(await verifyLocalHello(hello, desktop, phone, b.publicKey)).toBeNull();
    expect(await verifyLocalHello({ ...hello, target: desktop }, desktop, phone, a.publicKey)).toBeNull();
    expect(await verifyLocalHello({ ...hello, sentAt: 0 }, desktop, phone, a.publicKey)).toBeNull();
  });

  it("rejects tampering with authenticated ciphertext", async () => {
    const a = await identity();
    const b = await identity();
    const first = await startLocalHandshake(desktop, phone, a.sign);
    const second = await startLocalHandshake(phone, desktop, b.sign);
    const key = await sharedLocalSessionKey(first.secret, first.hello, second.hello);
    const wire = await new LocalCipher(key, desktop, phone).seal(
      makeEnvelope(desktop, phone, { type: "presence", state: "ready" }),
    );
    const altered = { ...wire, body: (wire.body.startsWith("A") ? "B" : "A") + wire.body.slice(1) };
    const receiver = new LocalCipher(await sharedLocalSessionKey(second.secret, second.hello, first.hello), phone, desktop);
    expect(await receiver.open(altered)).toBeNull();
    expect(await receiver.open(wire)).not.toBeNull();
  });
});
