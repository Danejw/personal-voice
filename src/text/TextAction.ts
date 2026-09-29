/** A spoken instruction applied to text the user already captured. */
export interface TextActionInput {
  selection: string;
  instruction: string;
}

/**
 * Turns selected text plus an instruction into replacement text.
 * Implementations stay behind this boundary so the app is not tied to one model.
 */
export interface TextAction {
  transform(input: TextActionInput, signal: AbortSignal): Promise<string>;
}
