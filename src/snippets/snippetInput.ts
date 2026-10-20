type SnippetInputInserter = (transcript: string) => boolean;

let inserter: SnippetInputInserter | null = null;
let accepted = false;

/** The Personal Voice composer registers this so a spoken trigger can insert `@slug`. */
export function registerSnippetInput(next: SnippetInputInserter): () => void {
  inserter = next;
  return () => {
    if (inserter === next) inserter = null;
  };
}

/**
 * Gives the finalized transcript to the focused Personal Voice input.
 * The input inserts compact snippet references and keeps the surrounding words.
 * Returns false when dictation should keep the normal destination path.
 */
export function acceptDictatedText(transcript: string): boolean {
  const ok = inserter?.(transcript) ?? false;
  accepted = ok;
  return ok;
}

/** True once after the composer accepted the reference for this utterance. */
export function consumeSnippetReferenceAcceptance(): boolean {
  const value = accepted;
  accepted = false;
  return value;
}
