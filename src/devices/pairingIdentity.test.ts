import { describe, expect, it } from "vitest";
import {
  pairingApprovalText, pairingClaimText, publicKeyFromJwk,
  publicPairingKey, signPairingText, verifyPairingText,
} from "@/devices/pairingIdentity";

async function makePair() {
  return crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"],
  );
}

describe("DeviceLink pairing proofs", () => {
  it("verifies the same text using a public key", async () => {
    const pair = await makePair();
    const publicKey = await publicPairingKey(pair);
    const text = pairingClaimText("00123456", "phone");
    const proof = await signPairingText(pair, text);
    expect(pair.privateKey.extractable).toBe(false);
    expect(publicKeyFromJwk(publicKey)).toEqual(publicKey);
    expect(await verifyPairingText(publicKey, text, proof)).toBe(true);
    expect(await verifyPairingText(publicKey, pairingClaimText("00123457", "phone"), proof)).toBe(false);
  });

  it("includes both devices and the invitation in approval", async () => {
    const issuer = await makePair();
    const joining = await makePair();
    const key = await publicPairingKey(joining);
    const text = pairingApprovalText("invite-1", "desktop", "phone", key);
    const proof = await signPairingText(issuer, text);
    const publicKey = await publicPairingKey(issuer);
    expect(await verifyPairingText(publicKey, text, proof)).toBe(true);
    expect(await verifyPairingText(publicKey,
      pairingApprovalText("invite-2", "desktop", "phone", key), proof)).toBe(false);
  });

  it("rejects malformed keys", async () => {
    const key = await publicPairingKey(await makePair());
    expect(publicKeyFromJwk({ ...key, x: "invalid" })).toBe(null);
  });
});
