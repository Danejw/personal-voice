import { callPlugin } from "@/platform/android/voicePlatformPlugin";
import { pairingCodeFromQr } from "@/devices/PairingQrCode";
import { devicePairingApi, type PairCode } from "@/services/devicePairingService";
import { verifiedPairLinks } from "@/services/verifiedPairLinks";

export type PairingAction = "open" | "show_code" | "scan_qr" | "enter_code" | "status";
export const PAIRING_UI_EVENT = "pv:pairing-ui";
export const PAIRING_FINISHED_EVENT = "pv:pairing-finished";

export type PairingViewRequest =
  | { kind: "open" }
  | { kind: "invite"; invite: PairCode }
  | { kind: "joined"; inviteId: string }
  | { kind: "error"; message: string };

export function openPairingUI(request: PairingViewRequest = { kind: "open" }): void {
  window.dispatchEvent(new CustomEvent<PairingViewRequest>(PAIRING_UI_EVENT, { detail: request }));
}

/** Existing signed pairing backend and native QR scanner; never auto-approves another device. */
export async function pairingAction(
  deviceId: string | null, platform: string, action: PairingAction, code?: string,
): Promise<string> {
  if (!deviceId || (platform !== "windows" && platform !== "android"))
    throw new Error("Sign in and register this device before pairing.");
  if (action === "open") {
    openPairingUI();
    return "Pairing window opened on this device. Choose Scan QR or enter a code on Android, or show a QR invitation on Windows.";
  }
  if (action === "status") {
    const links = await verifiedPairLinks(deviceId);
    return links.length
      ? `Verified paired devices: ${links.length}. Pairing status is confirmed by the server.`
      : "No verified paired devices yet. Show a code on Windows and scan it on Android.";
  }
  if (action === "show_code") {
    if (platform !== "windows") throw new Error("Show a pairing QR on the Windows computer.");
    const invite = await devicePairingApi.invite(deviceId);
    openPairingUI({ kind: "invite", invite });
    return `Pairing QR and eight-digit code ${invite.code.slice(0, 4)} ${invite.code.slice(4)} are displayed on this computer. Expires ${invite.expiresAt}. Waiting for Android to scan or enter the code, then approve on this computer.`;
  }
  if (action === "scan_qr") {
    if (platform !== "android") throw new Error("QR scanning is available on Android.");
    // The scanner is user-visible, and OS camera permission remains authoritative.
    openPairingUI();
    const scanned = await callPlugin<{ code: string }>("scan_pairing_qr");
    const value = pairingCodeFromQr(scanned.code) ?? (/^[0-9]{8}$/.test(scanned.code) ? scanned.code : null);
    if (!value) throw new Error("This is not a Personal Voice pairing QR code.");
    const id = await devicePairingApi.claim(deviceId, value);
    openPairingUI({ kind: "joined", inviteId: id });
    return "QR scanned and pairing requested. Waiting for the other device to approve the verified pairing.";
  }
  if (action === "enter_code") {
    if (platform !== "android") throw new Error("Enter the pairing code on Android.");
    if (!code || !/^[0-9]{8}$/.test(code.replace(/[\s-]/g, "")))
      throw new Error("Provide the eight-digit pairing code.");
    const id = await devicePairingApi.claim(deviceId, code);
    openPairingUI({ kind: "joined", inviteId: id });
    return "Pairing requested. The other device must approve before these devices are paired.";
  }
  throw new Error("Unknown pairing operation.");
}
