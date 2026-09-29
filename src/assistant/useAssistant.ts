import { useEffect, useState } from "react";
import type { AssistantController } from "@/assistant/AssistantController";
import type { AssistantSnapshot } from "@/assistant/state";

/** Subscribes to the in-memory Assistant conversation. */
export function useAssistant(controller: AssistantController): AssistantSnapshot {
  const [snapshot, setSnapshot] = useState(() => controller.getSnapshot());
  useEffect(() => controller.subscribe(setSnapshot), [controller]);
  return snapshot;
}
