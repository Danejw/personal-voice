import { useEffect, useRef, useState } from "react";
import { PairingQrCode } from "@/devices/PairingQrCode";
import { PAIRING_FINISHED_EVENT, PAIRING_UI_EVENT, pairingAction,
  type PairingViewRequest } from "@/devices/pairingFlow";
import { devicePairingApi, type PairCode, type PairInvite } from "@/services/devicePairingService";
import { verifyPairApproval, verifiedPairLinks } from "@/services/verifiedPairLinks";
import { deviceLinkManager } from "@/device-link/DeviceLinkManager";
import { saveRemoteComputerActions, saveRemoteReads } from "@/settings/deviceSettings";
import { loadRemoteVoiceDefault, saveRemoteVoiceDefault } from "@/assistant/remoteVoiceTarget";
import type { OwnedDevice } from "@/handoffs/handoff";
import "./pairingDialog.css";

/** One global dialog mounted in either the regular app or Android Companion.
 * The Assistant uses the same command/event path as the human buttons.
 */
export function PairingDialog({ deviceId, platform, devices }: {
  deviceId: string | null; platform: string; devices: OwnedDevice[];
}) {
  const [visible, setVisible] = useState(false);
  const [invite, setInvite] = useState<PairCode | null>(null);
  const [joined, setJoined] = useState<string | null>(null);
  const [request, setRequest] = useState<PairInvite | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const previousFocus = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const data = (event as CustomEvent<PairingViewRequest>).detail;
      if (!data) return;
      if (!visible) previousFocus.current = document.activeElement instanceof HTMLElement
        ? document.activeElement : null;
      setVisible(true);
      setNotice(data.kind === "error" ? data.message : "");
      if (data.kind === "invite") {
        setInvite(data.invite);
        setJoined(null);
        setRequest(null);
      } else if (data.kind === "joined") {
        setJoined(data.inviteId);
        setInvite(null);
        setRequest(null);
      }
    };
    window.addEventListener(PAIRING_UI_EVENT, handler);
    return () => window.removeEventListener(PAIRING_UI_EVENT, handler);
  }, [visible]);
  useEffect(() => {
    if (visible) closeButton.current?.focus();
  }, [visible]);

  useEffect(() => {
    if (!visible || !deviceId || !(invite || joined)) return;
    let active = true;
    const id = invite?.id ?? joined;
    const poll = async () => {
      if (!id) return;
      try {
        const state = await devicePairingApi.read(deviceId, id);
        if (!active) return;
        setRequest(state);
        if (state?.status === "approved") {
          const verified = await verifyPairApproval(deviceId, state);
          if (!active) return;
          if (!verified) {
            setNotice("Pairing verification failed.");
            return;
          }
          await verifiedPairLinks(deviceId);
          if (platform === "android" && state.issuerDeviceId !== deviceId &&
              !loadRemoteVoiceDefault(deviceId)) {
            saveRemoteVoiceDefault(deviceId, state.issuerDeviceId);
          }
          setNotice("Devices paired.");
          setInvite(null);
          setJoined(null);
          window.dispatchEvent(new Event(PAIRING_FINISHED_EVENT));
          void deviceLinkManager.refresh();
        } else if (state && (state.status === "cancelled" || Date.parse(state.expiresAt) <= Date.now())) {
          setNotice("Pairing expired or was cancelled.");
          setInvite(null);
          setJoined(null);
        }
      } catch {
        if (active) setNotice("Pairing connection unavailable.");
      }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [deviceId, invite, joined, visible, platform]);

  useEffect(() => {
    if (!visible) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setVisible(false);
      }
      if (event.key === "Tab") {
        const dialog = document.querySelector<HTMLElement>("[data-pairing-dialog]");
        const focusable = dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled])',
        );
        if (!focusable?.length) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [visible]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try { await work(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Pairing unavailable."); }
    finally { setBusy(false); }
  };
  const close = () => {
    setVisible(false);
    if (invite && deviceId) {
      void devicePairingApi.cancel(deviceId, invite.id).catch(() => undefined);
    }
    setInvite(null);
    setJoined(null);
    setRequest(null);
    previousFocus.current?.focus();
  };
  if (!visible) return null;
  const ready = !!deviceId && (platform === "windows" || platform === "android");
  const peerName = request?.claimantDeviceId
    ? devices.find(d => d.id === request.claimantDeviceId)?.name ?? "Android device" : "device";

  return (
    <div className="pv-pair-backdrop" onPointerDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <section className="pv-pair-dialog" data-pairing-dialog role="dialog" aria-modal="true"
        aria-labelledby="pv-pair-title" aria-describedby="pv-pair-description">
        <button ref={closeButton} className="pv-pair-close" type="button"
          aria-label="Close pairing" onClick={close}>×</button>
        <div className="pv-pair-header">
          <span className="pv-pair-mark" aria-hidden="true">PV</span>
          <h2 id="pv-pair-title">Pair a device</h2>
          <p id="pv-pair-description">Connect your phone and computer</p>
        </div>
        {!ready ? <p role="alert">Sign in and register this device before pairing.</p> : (
          <>
            {platform === "windows" && (invite ? (
              <div className="pv-pair-content">
                <div className="pv-pair-qr"><PairingQrCode code={invite.code} /></div>
                <p className="pv-pair-code" aria-label="Eight digit pairing code">
                  {invite.code.slice(0, 4)} {invite.code.slice(4)}
                </p>
                <p className="pv-pair-hint">Scan with Personal Voice on Android, or enter this code.</p>
                <p className="pv-pair-hint">Expires {new Date(invite.expiresAt).toLocaleTimeString([], {
                  hour: "numeric", minute: "2-digit",
                })}</p>
                {request?.status === "claimed" && (
                  <p className="pv-pair-hint">This paired phone can control and view your unlocked PC. You can disable this in Windows settings or unpair it.</p>
                )}
                {request?.status === "claimed" && (
                  <button className="pv-pair-primary" type="button" disabled={busy}
                    onClick={() => void run(async () => {
                      if (!deviceId) return;
                      await devicePairingApi.approve(deviceId, request, invite.code);
                      // Explicit pairing consent includes Companion control of this unlocked PC.
                      // Both permissions remain independently revocable in Windows settings.
                      saveRemoteComputerActions(true);
                      saveRemoteReads(true);
                      setNotice("Pairing approved. Companion control enabled.");
                    })}>Approve & allow control for {peerName}</button>
                )}
                <button className="pv-pair-secondary" type="button" disabled={busy}
                  onClick={() => void run(async () => {
                    if (!deviceId) return;
                    await devicePairingApi.cancel(deviceId, invite.id);
                    setInvite(null);
                    setRequest(null);
                  })}>Cancel code</button>
              </div>
            ) : (
              <button className="pv-pair-primary" disabled={busy} type="button"
                onClick={() => void run(async () => {
                  await pairingAction(deviceId, platform, "show_code");
                })}>Show pairing QR and code</button>
            ))}
            {platform === "android" && (joined ? (
              <div className="pv-pair-content">
                <div className="pv-pair-pulse" aria-hidden="true" />
                <p>Waiting for computer approval…</p>
                <p className="pv-pair-hint">Confirm the request on your Windows PC.</p>
              </div>
            ) : (
              <div className="pv-pair-content">
                <button className="pv-pair-primary" type="button" disabled={busy}
                  onClick={() => void run(async () => {
                    await pairingAction(deviceId, platform, "scan_qr");
                  })}>Scan QR code</button>
                <p className="pv-pair-or">or enter the code</p>
                <form onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await pairingAction(deviceId, platform, "enter_code", code);
                  });
                }}>
                  <input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 ]{8,9}"
                    maxLength={9} aria-label="Eight-digit pairing code"
                    placeholder="0000 0000" value={code}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, "").slice(0, 8);
                      setCode(digits.length > 4 ? digits.slice(0, 4) + " " + digits.slice(4) : digits);
                    }} />
                  <button type="submit" className="pv-pair-secondary"
                    disabled={busy || code.replace(/\D/g, "").length !== 8}>Pair</button>
                </form>
              </div>
            ))}
          </>
        )}
        {notice && <p className="pv-pair-notice" role="status">{notice}</p>}
        <button className="pv-pair-dismiss" type="button" onClick={close}>Done</button>
      </section>
    </div>
  );
}
