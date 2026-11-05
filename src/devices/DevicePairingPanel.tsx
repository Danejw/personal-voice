import { useEffect, useState } from "react";
import { deviceLinkManager } from "@/device-link/DeviceLinkManager";
import { loadRemoteVoiceDefault, saveRemoteVoiceDefault } from "@/assistant/remoteVoiceTarget";
import { PAIRING_FINISHED_EVENT, pairingAction } from "@/devices/pairingFlow";
import { devicePairingApi, type PairLink } from "@/services/devicePairingService";
import { verifiedPairLinks } from "@/services/verifiedPairLinks";
import type { OwnedDevice } from "@/handoffs/handoff";

/** Paired-device list. Every pairing entry point opens the same centered dialog. */
export function DevicePairingPanel({ deviceId, platform, devices }: {
  deviceId: string; platform: string; devices: OwnedDevice[];
}) {
  const [links, setLinks] = useState<PairLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [defaultVoiceTarget, setDefaultVoiceTarget] = useState(() => loadRemoteVoiceDefault(deviceId));
  const [transport, setTransport] = useState(deviceLinkManager.getSnapshot);

  useEffect(() => deviceLinkManager.subscribe(() => setTransport(deviceLinkManager.getSnapshot())), []);
  useEffect(() => {
    setDefaultVoiceTarget(loadRemoteVoiceDefault(deviceId));
    let active = true;
    const load = async () => {
      try {
        const found = await verifiedPairLinks(deviceId);
        if (active) {
          setLinks(found);
          setDefaultVoiceTarget(loadRemoteVoiceDefault(deviceId));
        }
      } catch { if (active) setNotice("Pairing unavailable."); }
    };
    void load();
    window.addEventListener(PAIRING_FINISHED_EVENT, load);
    return () => { active = false; window.removeEventListener(PAIRING_FINISHED_EVENT, load); };
  }, [deviceId]);

  const unpair = async (link: PairLink) => {
    setBusy(true);
    setNotice("");
    try {
      await devicePairingApi.revoke(deviceId, link.id);
      if (defaultVoiceTarget === link.peerDeviceId) {
        saveRemoteVoiceDefault(deviceId, null);
        setDefaultVoiceTarget(null);
      }
      setLinks(await verifiedPairLinks(deviceId));
      void deviceLinkManager.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unpair failed.");
    } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <button type="button" className="secondary"
        onClick={() => void pairingAction(deviceId, platform,
          platform === "windows" ? "show_code" : "open").catch(error => {
          setNotice(error instanceof Error ? error.message : "Pairing unavailable.");
        })}>Pair device</button>
      {links.map(link => (
        <div className="item-row" key={link.id}>
          <strong>{devices.find(d => d.id === link.peerDeviceId)?.name ?? "Other device"}
            {transport.localPeers.includes(link.peerDeviceId) && <span className="note-meta"> · LAN</span>}
          </strong>
          {platform === "android" && devices.find(d => d.id === link.peerDeviceId)?.platform === "windows" && (
            <button type="button" className="secondary" disabled={busy}
              aria-pressed={defaultVoiceTarget === link.peerDeviceId}
              onClick={() => {
                const next = defaultVoiceTarget === link.peerDeviceId ? null : link.peerDeviceId;
                saveRemoteVoiceDefault(deviceId, next);
                setDefaultVoiceTarget(next);
              }}>{defaultVoiceTarget === link.peerDeviceId ? "Voice default" : "Use for voice"}</button>
          )}
          <button type="button" className="secondary" disabled={busy}
            onClick={() => void unpair(link)}>Unpair</button>
        </div>
      ))}
      {notice && <p role="status" className="note-meta">{notice}</p>}
    </div>
  );
}
