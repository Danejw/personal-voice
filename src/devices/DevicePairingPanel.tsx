import { useEffect, useState } from "react";
import { callPlugin } from "@/platform/android/voicePlatformPlugin";
import { deviceLinkManager } from "@/device-link/DeviceLinkManager";
import { loadRemoteVoiceDefault, saveRemoteVoiceDefault } from "@/assistant/remoteVoiceTarget";
import { PairingQrCode } from "@/devices/PairingQrCode";
import { devicePairingApi, type PairInvite, type PairCode } from "@/services/devicePairingService";
import { verifyPairApproval, verifiedPairLinks } from "@/services/verifiedPairLinks";
import type { PairLink } from "@/services/devicePairingService";
import type { OwnedDevice } from "@/handoffs/handoff";

export function DevicePairingPanel({ deviceId, platform, devices }: { deviceId: string; platform: string; devices: OwnedDevice[] }) {
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState<PairCode | null>(null);
  const [request, setRequest] = useState<PairInvite | null>(null);
  const [entered, setEntered] = useState("");
  const [joined, setJoined] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [links, setLinks] = useState<PairLink[]>([]);
  const [defaultVoiceTarget, setDefaultVoiceTarget] = useState(() => loadRemoteVoiceDefault(deviceId));
  const [transport, setTransport] = useState(deviceLinkManager.getSnapshot);
  useEffect(() => deviceLinkManager.subscribe(() => setTransport(deviceLinkManager.getSnapshot())), []);
  useEffect(() => setDefaultVoiceTarget(loadRemoteVoiceDefault(deviceId)), [deviceId]);


  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      try {
        await devicePairingApi.register(deviceId);
        const current = await verifiedPairLinks(deviceId);
        if (!active) return;
        setLinks(current);

      } catch (error) {
        if (active) setNotice(error instanceof Error ? error.message : "Pairing unavailable.");
      }
    })();
    return () => { active = false; };
  }, [deviceId, open]);

  useEffect(() => {
    if (!open || !(invite || joined)) return;
    const id = invite?.id ?? joined;
    let active = true;
    const refresh = async () => {
      if (!id) return;
      try {
        const state = await devicePairingApi.read(deviceId, id);
        if (!active) return;
        setRequest(state);
        if (state?.status === "approved") {
          const verified = await verifyPairApproval(deviceId, state);
          setNotice(verified ? "Devices paired." : "Pairing verification failed.");
          if (verified) {
            setLinks(await verifiedPairLinks(deviceId));
            void deviceLinkManager.refresh();
          }
          setInvite(null);
          setJoined(null);
        } else if (state && Date.parse(state.expiresAt) < Date.now()) {
          setNotice("Invitation expired.");
          setInvite(null);
          setJoined(null);
        }
      } catch { if (active) setNotice("Pairing connection unavailable."); }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [deviceId, invite, joined, open]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try { await action(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Pairing failed."); }
    finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <button type="button" className="secondary" onClick={() => setOpen(!open)}>
        {open ? "Close pairing" : "Pair device"}
      </button>
      {open && platform === "windows" && (
        <>
          {invite ? (
            <>
              <PairingQrCode code={invite.code} />
              <p className="device-title"><strong>{invite.code.slice(0, 4)} {invite.code.slice(4)}</strong></p>
              <p className="note-meta">Enter this code on your phone within five minutes.</p>
              {request?.status === "claimed" && (
                <button type="button" disabled={busy} onClick={() => void run(async () => {
                  await devicePairingApi.approve(deviceId, request, invite.code);
                  setInvite(null);
                  setLinks(await verifiedPairLinks(deviceId));
                  void deviceLinkManager.refresh();
                  setNotice("Devices paired.");
                })}>Approve {devices.find((device) => device.id === request.claimantDeviceId)?.name ?? "device"}</button>
              )}
              <button type="button" className="secondary" disabled={busy}
                onClick={() => void run(async () => {
                  await devicePairingApi.cancel(deviceId, invite.id);
                  setInvite(null);
                })}>Cancel invitation</button>
            </>
          ) : <button type="button" disabled={busy} onClick={() => void run(async () => {
            setInvite(await devicePairingApi.invite(deviceId));
          })}>Show pairing code</button>}
        </>
      )}
      {open && platform === "android" && (
        joined ? <p role="status">Waiting for computer approval…</p> :
        <form className="stack" onSubmit={(event) => {
          event.preventDefault();
          void run(async () => setJoined(await devicePairingApi.claim(deviceId, entered)));
        }}>
          <input aria-label="Pairing code" inputMode="numeric" maxLength={9} placeholder="8-digit code" value={entered}
            onChange={(event) => setEntered(event.target.value)} />
          <button type="submit" disabled={busy || !/^[0-9]{8}$/.test(entered.replace(/[\s-]/g, ""))}>Pair</button>
          <button type="button" className="secondary" disabled={busy}
            onClick={() => void run(async () => {
              const result = await callPlugin<{ code: string }>("scan_pairing_qr");
              setJoined(await devicePairingApi.claim(deviceId, result.code));
            })}>Scan QR</button>
        </form>
      )}
      {open && links.map((link) => (
        <div className="item-row" key={link.id}>
          <strong>{devices.find((device) => device.id === link.peerDeviceId)?.name ?? "Other device"}
            {transport.localPeers.includes(link.peerDeviceId) && <span className="note-meta"> · LAN</span>}
          </strong>
          {platform === "android" && devices.find(d => d.id === link.peerDeviceId)?.platform === "windows" && (
            <button type="button" className="secondary"
              disabled={busy}
              aria-pressed={defaultVoiceTarget === link.peerDeviceId}
              onClick={() => void run(async () => {
                const next = defaultVoiceTarget === link.peerDeviceId ? null : link.peerDeviceId;
                saveRemoteVoiceDefault(deviceId, next);
                setDefaultVoiceTarget(next);
              })}>
              {defaultVoiceTarget === link.peerDeviceId ? "Voice default" : "Use for voice"}
            </button>
          )}
          <button type="button" className="secondary" disabled={busy}
                  onClick={() => void run(async () => {
                    if (!window.confirm("Allow this paired phone to open Notepad or Calculator and use Escape or Tab for up to 14 minutes without approving each action?")) return;
                    await trustedRemoteApi.start(deviceId, link.peerDeviceId);
                    setTrustedGrants(await trustedRemoteApi.list(deviceId));
                  })}>Allow trusted control</button>
              )}
            </>
          )}
          <button type="button" className="secondary" disabled={busy}
            onClick={() => void run(async () => {
              await devicePairingApi.revoke(deviceId, link.id);
              if (defaultVoiceTarget === link.peerDeviceId) {
                saveRemoteVoiceDefault(deviceId, null);
                setDefaultVoiceTarget(null);
              }
              setLinks(await verifiedPairLinks(deviceId));
              void deviceLinkManager.refresh();
            })}>Unpair</button>
        </div>
      ))}
      {open && notice && <p role="status" className="note-meta">{notice}</p>}
    </div>
  );
}
