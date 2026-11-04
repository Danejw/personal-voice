import { useMemo } from "react";
import { qrcodegen } from "@/devices/vendor/qrcodegen";

export const PAIR_QR_PREFIX = "pv-pair:v1:";

/** Keep QR content limited to a short-lived invitation code, never a key. */
export function pairingCodeFromQr(value: string): string | null {
  const code = value.startsWith(PAIR_QR_PREFIX) ? value.slice(PAIR_QR_PREFIX.length) : null;
  return code && /^[0-9]{8}$/.test(code) ? code : null;
}

export function PairingQrCode({ code }: { code: string }) {
  const qr = useMemo(
    () => qrcodegen.QrCode.encodeText(PAIR_QR_PREFIX + code, qrcodegen.QrCode.Ecc.MEDIUM),
    [code],
  );
  const margin = 4;
  const extent = qr.size + margin * 2;
  const commands: string[] = [];
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (qr.getModule(x, y)) commands.push(`M${x + margin} ${y + margin}h1v1h-1z`);
    }
  }
  return (
    <svg viewBox={`0 0 ${extent} ${extent}`} width="190" height="190"
      role="img" aria-label="Scan this pairing code with Personal Voice on your phone"
      shapeRendering="crispEdges">
      <rect width={extent} height={extent} fill="#fff" />
      <path d={commands.join("")} fill="#111" />
    </svg>
  );
}
