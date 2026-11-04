import { useEffect, useState } from "react";
import { devicePairingApi, type PairInvite, type PairCode } from "@/services/devicePairingService";
import { verifyPairApproval } from "@/services/verifiedPairLinks";

export function DevicePairingPanel({ deviceId, platform }: { deviceId: string; platform: string }) {
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState<PairCode | null>(null);
  const [request, setRequest] = useState<PairInvite | null>(null);
  const [entered, setEntered] = useState("");
  const [joined, setJoined] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

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
          setNotice(await verifyPairApproval(deviceId, state) ? "Devices paired." : "Pairing verification failed.");
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
              <p className="device-title"><strong>{invite.code.slice(0, 4)} {invite.code.slice(4)}</strong></p>
              <p className="note-meta">Enter this code on your phone within five minutes.</p>
              {request?.status === "claimed" && (
                <button type="button" disabled={busy} onClick={() => void run(async () => {
                  await devicePairingApi.approve(deviceId, request, invite.code);
                  setInvite(null);
                  setNotice("Devices paired.");
                })}>Approve device</button>
              )}
            </>
          ) : <button type="button" disabled={busy} onClick={() => void run(async () => {
            setInvite(await devicePairingApi.invite(deviceId));
          })}>Show pairing code</button>}
        </>
      )}
      {open && platform === "android" && (
        joined ? <p role="status">Waiting for computer approval…</p> :
        <form onSubmit={(event) => {
          event.preventDefault();
          void run(async () => setJoined(await devicePairingApi.claim(deviceId, entered)));
        }}>
          <input aria-label="Pairing code" inputMode="numeric" maxLength={9} value={entered}
            onChange={(event) => setEntered(event.target.value)} />
          <button type="submit" disabled={busy}>Pair</button>
        </form>
      )}
      {open && notice && <p role="status" className="note-meta">{notice}</p>}
    </div>
  );
}
