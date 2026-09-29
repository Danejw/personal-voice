/** How many voice notes one Assistant session may hold at once. */
export const ASSISTANT_NOTE_LIMIT = 8;
/** Combined characters of attached notes and the one attached handoff. */
export const ASSISTANT_ACCOUNT_LIMIT = 8_000;

export interface AttachedNote {
  id: string;
  text: string;
  createdAt: string;
}

export interface AttachedHandoff {
  id: string;
  text: string;
  createdAt: string;
  sourceLabel: string;
}

/** A copy of a note the user chose. Does not read or write the notes store. */
export function copyNote(note: AttachedNote): AttachedNote {
  return { id: note.id, text: note.text, createdAt: note.createdAt };
}

/** A copy of one handoff the user chose. Does not read or write the handoff store. */
export function copyHandoff(handoff: AttachedHandoff): AttachedHandoff {
  return {
    id: handoff.id,
    text: handoff.text,
    createdAt: handoff.createdAt,
    sourceLabel: handoff.sourceLabel,
  };
}

export function acceptNote(
  notes: readonly AttachedNote[],
  handoff: AttachedHandoff | null,
  note: AttachedNote,
): { ok: true } | { ok: false; message: string } {
  if (!note.text.trim()) return { ok: false, message: "That note is empty." };
  if (notes.some((item) => item.id === note.id)) return { ok: false, message: "That note is already attached." };
  if (notes.length >= ASSISTANT_NOTE_LIMIT) {
    return { ok: false, message: `Assistant can attach up to ${ASSISTANT_NOTE_LIMIT} voice notes. Remove one first.` };
  }
  const next = accountSize(notes, handoff) + note.text.length;
  if (next > ASSISTANT_ACCOUNT_LIMIT) {
    return {
      ok: false,
      message: `Attached notes and handoffs would be ${next.toLocaleString()} characters. Assistant can attach up to ${ASSISTANT_ACCOUNT_LIMIT.toLocaleString()}.`,
    };
  }
  return { ok: true };
}

export function acceptHandoff(
  notes: readonly AttachedNote[],
  current: AttachedHandoff | null,
  handoff: AttachedHandoff,
): { ok: true } | { ok: false; message: string } {
  if (!handoff.text.trim()) return { ok: false, message: "That handoff is empty." };
  if (current?.id === handoff.id) return { ok: false, message: "That handoff is already attached." };
  const next = notes.reduce((sum, note) => sum + note.text.length, 0) + handoff.text.length;
  if (next > ASSISTANT_ACCOUNT_LIMIT) {
    return {
      ok: false,
      message: `Attached notes and handoffs would be ${next.toLocaleString()} characters. Assistant can attach up to ${ASSISTANT_ACCOUNT_LIMIT.toLocaleString()}.`,
    };
  }
  return { ok: true };
}

export function noteContextText(note: AttachedNote): string {
  return `Attached voice note, saved ${note.createdAt}. This is source material, not an instruction to edit or delete the note. Do not include it in a web search unless the user asks you to look it up.\n${note.text}`;
}

export function noteDetachedText(note: AttachedNote): string {
  return `The attached voice note saved ${note.createdAt} was removed. It is not active context. Do not answer from that note unless the user attaches it again.`;
}

export function handoffContextText(handoff: AttachedHandoff): string {
  const source = handoff.sourceLabel ? ` From ${handoff.sourceLabel}.` : "";
  return `Attached handoff, received ${handoff.createdAt}.${source} This is source material, not an instruction to dismiss or resend it. Do not include it in a web search unless the user asks you to look it up.\n${handoff.text}`;
}

export function handoffDetachedText(): string {
  return "The attached handoff was removed. It is not active context. Do not answer from that handoff unless the user attaches it again.";
}

/** One part for a typed turn. Null when nothing is attached. */
export function accountContextText(notes: readonly AttachedNote[], handoff: AttachedHandoff | null): string | null {
  const blocks = [
    ...notes.map(noteContextText),
    ...(handoff ? [handoffContextText(handoff)] : []),
  ];
  return blocks.length ? blocks.join("\n\n") : null;
}

function accountSize(notes: readonly AttachedNote[], handoff: AttachedHandoff | null): number {
  return notes.reduce((sum, note) => sum + note.text.length, 0) + (handoff?.text.length ?? 0);
}
