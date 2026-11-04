import { describe, expect, it } from "vitest";
import { verifyPairingText, type PublicPairingKey } from "@/devices/pairingIdentity";
import { remoteRequestProofText, remoteResponseProofText } from "@/assistant/remoteVoiceProof";

const phone = "00000000-0000-4000-8000-000000000003";
const pc = "00000000-0000-4000-8000-000000000001";
const otherPc = "00000000-0000-4000-8000-000000000002";
const id = "00000000-0000-4000-8000-000000000004";

async function fixture() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const raw = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const pub: PublicPairingKey = { kty: "EC", crv: "P-256", x: raw.x!, y: raw.y! };
  const sign = async (message: string) => {
    const bytes = new Uint8Array(await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(message),
    ));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  return { pub, sign };
}

describe("device-bound remote voice signatures", () => {
  it("binds exact target, action and argument without exposing argument plaintext", async () => {
    const { pub, sign } = await fixture();
    const text = await remoteRequestProofText("action", id, phone, pc, "insert_text", "private text");
    expect(text).not.toContain("private text");
    const signature = await sign(text);
    expect(await verifyPairingText(pub, text, signature)).toBe(true);
    const retarget = await remoteRequestProofText("action", id, phone, otherPc, "insert_text", "private text");
    expect(await verifyPairingText(pub, retarget, signature)).toBe(false);
    const altered = await remoteRequestProofText("action", id, phone, pc, "insert_text", "changed");
    expect(await verifyPairingText(pub, altered, signature)).toBe(false);
  });
  it("never mistakes an approval, denial or read for a successful action receipt", async () => {
    const { pub, sign } = await fixture();
    const confirmed = await remoteResponseProofText("action", id, phone, pc, "answered", "Opened Notepad");
    const signature = await sign(confirmed);
    expect(await verifyPairingText(pub, confirmed, signature)).toBe(true);
    expect(await verifyPairingText(pub, await remoteResponseProofText("action", id, phone, pc, "denied", "Opened Notepad"), signature)).toBe(false);
    expect(await verifyPairingText(pub, await remoteResponseProofText("read", id, phone, pc, "answered", "Opened Notepad"), signature)).toBe(false);
    expect(await verifyPairingText(pub, await remoteResponseProofText("action", id, phone, pc, "answered", "Queued"), signature)).toBe(false);
  });
});
