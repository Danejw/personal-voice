import type { ContextItem } from "@/context/ContextItem";

/**
 * Selection rewrite lifecycle. Replace is only available from `preview`,
 * which is reached after a non-empty transform succeeds.
 */
export type SelectionFlow =
  | { phase: "idle" }
  | { phase: "captured"; item: ContextItem }
  | { phase: "listening"; item: ContextItem | null }
  | { phase: "transforming"; item: ContextItem; instruction: string }
  | { phase: "preview"; item: ContextItem; instruction: string; result: string }
  | { phase: "error"; item: ContextItem | null; message: string };

export type SelectionFlowAction =
  | { type: "captured"; item: ContextItem }
  | { type: "clear" }
  | { type: "listen" }
  | { type: "instruction"; text: string }
  | { type: "preview"; result: string }
  | { type: "fail"; message: string }
  | { type: "cancel" };

export const initialSelectionFlow: SelectionFlow = { phase: "idle" };

/** The captured selection, when this phase still has one. */
export function selectionItem(state: SelectionFlow): ContextItem | null {
  switch (state.phase) {
    case "idle": return null;
    case "captured":
    case "listening":
    case "transforming":
    case "preview":
      return state.item;
    case "error":
      return state.item;
    default: {
      const unhandled: never = state;
      throw new Error(`Unhandled selection phase: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Hold-to-speak captures the current highlight. It waits while a rewrite is already running. */
export function canListen(state: SelectionFlow): boolean {
  switch (state.phase) {
    case "idle":
    case "captured":
    case "preview":
    case "error":
      return true;
    case "listening":
    case "transforming":
      return false;
    default: {
      const unhandled: never = state;
      throw new Error(`Unhandled selection phase: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Replace is offered only after a successful non-empty rewrite. */
export function canReplace(state: SelectionFlow): boolean {
  return state.phase === "preview" && state.result.length > 0;
}

export function selectionFlowReducer(state: SelectionFlow, action: SelectionFlowAction): SelectionFlow {
  switch (action.type) {
    case "captured":
      if (state.phase === "transforming") return state;
      if (state.phase === "listening") return { phase: "listening", item: action.item };
      return { phase: "captured", item: action.item };
    case "clear":
      return { phase: "idle" };
    case "listen":
      if (!canListen(state)) return state;
      return { phase: "listening", item: null };
    case "instruction": {
      if (state.phase !== "listening" || !state.item) return state;
      const text = action.text.trim();
      if (!text) return { phase: "error", item: state.item, message: "Say what to do with the selection." };
      return { phase: "transforming", item: state.item, instruction: text };
    }
    case "preview": {
      if (state.phase !== "transforming") return state;
      const result = action.result.trim();
      if (!result) return { phase: "error", item: state.item, message: "The rewrite was empty." };
      return { phase: "preview", item: state.item, instruction: state.instruction, result };
    }
    case "fail":
      if (state.phase !== "listening" && state.phase !== "transforming") return state;
      return { phase: "error", item: selectionItem(state), message: action.message };
    case "cancel": {
      if (state.phase !== "listening" && state.phase !== "transforming" && state.phase !== "preview") return state;
      const item = selectionItem(state);
      return item ? { phase: "captured", item } : { phase: "idle" };
    }
    default: {
      const unhandled: never = action;
      throw new Error(`Unhandled selection action: ${JSON.stringify(unhandled)}`);
    }
  }
}
