import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { IndicatorState } from "@/platform/PlatformAdapter";

function labelFor(state: IndicatorState): string {
  switch (state.kind) {
    case "listening": return "Listening";
    case "finalizing": return "Transcribing";
    case "error": return state.message;
    default: {
      const unhandled: never = state;
      throw new Error(`Unhandled indicator state: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Content of the click-through, always-on-top indicator window. */
export default function Indicator() {
  const [state, setState] = useState<IndicatorState | null>(null);

  useEffect(() => {
    const pending = listen<IndicatorState>("indicator-state", (event) => setState(event.payload));
    return () => void pending.then((unlisten) => unlisten());
  }, []);

  if (!state) return null;
  return (
    <div className={`indicator indicator-${state.kind}`} role="status" title={labelFor(state)}>
      <span className="indicator-dot" aria-hidden="true" />
      <span className="indicator-label">{labelFor(state)}</span>
    </div>
  );
}
