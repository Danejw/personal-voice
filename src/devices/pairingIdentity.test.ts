import { describe, expect, it } from "vitest";
import {
  pairingApprovalText, pairingClaimText, publicKeyFromJwk, deviceProofPayload,
  verifyPairingText,
} from "@/devices/pairingIdentity";

async function fixture() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const raw = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicJwk = publicKeyFromJwk(raw);
  if (!publicJwk) throw new Error("Invalid fixture public key.");
  const sign = async (message: string) => {
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" },
      pair.privateKey, new TextEncoder().encode(message)));
    return btoa(String.fromCharCode(...signature)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  return { pair, publicJwk, sign };
}

describe("DeviceLink signing protocol", () => {
  it("requires the original key and message", async () => {
    const { pair, publicJwk, sign } = await fixture();
    const text = pairingClaimText("00123456", "phone");
    const signature = await sign(text);
    expect(pair.privateKey.extractable).toBe(false);
    expect(signature).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(await verifyPairingText(publicJwk, text, signature)).toBe(true);
    expect(await verifyPairingText(publicJwk, pairingClaimText("00123457", "phone"), signature)).toBe(false);
    const another = await fixture();
    expect(await verifyPairingText(another.publicJwk, text, signature)).toBe(false);
  });

  it("includes both devices, invitation and joining key in approval", async () => {
    const issuer = await fixture();
    const joining = await fixture();
    const text = pairingApprovalText("invite-1", "desktop", "phone", joining.publicJwk);
    const signature = await issuer.sign(text);
    expect(await verifyPairingText(issuer.publicJwk, text, signature)).toBe(true);
    expect(await verifyPairingText(issuer.publicJwk,
      pairingApprovalText("invite-2", "desktop", "phone", joining.publicJwk), signature)).toBe(false);
    expect(await verifyPairingText(issuer.publicJwk,
      pairingApprovalText("invite-1", "laptop", "phone", joining.publicJwk), signature)).toBe(false);
  });

  it("binds signed server operations to a nonce, timestamp and exact arguments", async () => {
    const device = await fixture();
    const base = deviceProofPayload("revoke", "desktop", "nonce-1", 1234, { linkId: "pair-1" });
    const signature = await device.sign(base);
    expect(await verifyPairingText(device.publicJwk, base, signature)).toBe(true);
    expect(await verifyPairingText(device.publicJwk,
      deviceProofPayload("revoke", "desktop", "nonce-2", 1234, { linkId: "pair-1" }), signature)).toBe(false);
    expect(await verifyPairingText(device.publicJwk,
      deviceProofPayload("revoke", "desktop", "nonce-1", 1234, { linkId: "pair-2" }), signature)).toBe(false);
  });

  it("rejects malformed keys and signatures", async () => {
    const { publicJwk } = await fixture();
    expect(publicKeyFromJwk({ ...publicJwk, x: "invalid" })).toBe(null);
    expect(await verifyPairingText(publicJwk, "anything", "invalid!")).toBe(false);
  });
});
