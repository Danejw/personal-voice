import { classifyHandoffText, handoffDisplayText } from "@/assistant/continuation";

/** How many saved items one tool result lists. */
export const ACCOUNT_LIST_COUNT = 12;
/** Characters kept from each item. The id stays whole so a later tool can target it. */
export const ACCOUNT_ITEM_CHARS = 500;

export interface ListedNote {
  id: string;
  text: string;
  status: "inbox" | "archived";
  createdAt: string;
}

export interface ListedHandoff {
  id: string;
  text: string;
  createdAt: string;
  sourceLabel: string;
}

/** Inbox notes, or every note when the caller asked for archived ones too. */
export function formatNoteList(notes: readonly ListedNote[], includeArchived: boolean): string {
  const rows = notes.filter((note) => includeArchived || note.status === "inbox");
  if (!rows.length) {
    return includeArchived
      ? "No notes."
      : "No notes in the inbox. Archived notes stay hidden until include_archived is true.";
  }
  return joinList("Notes", rows.length, rows.map(formatNote));
}

/** Other device names, then received handoffs. Continuation packages are shown by title only. */
export function formatHandoffList(devices: readonly string[], handoffs: readonly ListedHandoff[]): string {
  const deviceLine = devices.length
    ? `Devices you can send to: ${devices.join(", ")}.`
    : "No other device is on this account.";
  if (!handoffs.length) return `${deviceLine}\nNo received handoffs.`;
  return `${deviceLine}\n${joinList("Received handoffs", handoffs.length, handoffs.map(formatHandoff))}`;
}

function joinList(label: string, total: number, blocks: string[]): string {
  const shown = blocks.slice(0, ACCOUNT_LIST_COUNT);
  const hidden = total - shown.length;
  const tail = hidden > 0 ? `\n${hidden} more were not listed.` : "";
  return `${label} (${total}):\n${shown.join("\n\n")}${tail}`;
}

function formatNote(note: ListedNote, index: number): string {
  return `${index + 1}. id: ${note.id}\nstatus: ${note.status}\nsaved: ${note.createdAt}\n${clip(note.text)}`;
}

function formatHandoff(handoff: ListedHandoff, index: number): string {
  const kind = classifyHandoffText(handoff.text);
  const label = kind.kind === "text" ? "text" : "continuation";
  return `${index + 1}. id: ${handoff.id}\nfrom: ${handoff.sourceLabel}\nkind: ${label}\nsaved: ${handoff.createdAt}\n${clip(handoffDisplayText(handoff.text))}`;
}

function clip(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= ACCOUNT_ITEM_CHARS) return trimmed;
  return `${trimmed.slice(0, ACCOUNT_ITEM_CHARS - 1)}…`;
}
