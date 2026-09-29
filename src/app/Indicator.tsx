import { useCallback, useEffect, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { OverlayDock } from "@/overlay/OverlayDock";
import { emptyOverlaySnapshot } from "@/overlay/overlay";
import type { OverlayAction, OverlaySnapshot } from "@/overlay/overlay";

/** Always-on-top Personal Voice buttons. Dictation still runs in the main window. */
export default function Indicator() {
  const [snapshot, setSnapshot] = useState<OverlaySnapshot>({ ...emptyOverlaySnapshot, visible: true });

  useEffect(() => {
    const pending = listen<OverlaySnapshot>("overlay-snapshot", (event) => setSnapshot(event.payload));
    return () => void pending.then((unlisten) => unlisten());
  }, []);

  const onAction = useCallback((action: OverlayAction) => {
    void emitTo("main", "overlay-action", action);
  }, []);

  return <OverlayDock snapshot={snapshot} onAction={onAction} />;
}
