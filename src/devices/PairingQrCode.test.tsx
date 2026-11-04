import { describe, expect, it } from "vitest";
import { pairingCodeFromQr, PAIR_QR_PREFIX } from "@/devices/PairingQrCode";
import { qrcodegen } from "@/devices/vendor/qrcodegen";

describe("DeviceLink pairing QR", () => {
  it("round-trips the short-lived invitation payload", () => {
    const code = "00001234";
    expect(pairingCodeFromQr(PAIR_QR_PREFIX + code)).toBe(code);
    const qr = qrcodegen.QrCode.encodeText(PAIR_QR_PREFIX + code, qrcodegen.QrCode.Ecc.MEDIUM);
    expect(qr.size).toBeGreaterThan(20);
    expect(qr.getModule(3, 3)).toBe(true);
  });
  it("rejects unrelated or malformed QR text", () => {
    expect(pairingCodeFromQr("other:00001234")).toBeNull();
    expect(pairingCodeFromQr(PAIR_QR_PREFIX + "1234")).toBeNull();
    expect(pairingCodeFromQr(PAIR_QR_PREFIX + "12345678extra")).toBeNull();
  });
});
