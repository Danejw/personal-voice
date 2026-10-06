import type { Note } from "@/notes/note";
import type { NoteGroup } from "@/notes/noteGroup";
import type {
  ExistingGroupAssignment,
  NewNoteGroupSuggestion,
  NoteOrganizationPlan,
  NotesOrganizerApi,
  NoteTitleSuggestion,
} from "@/notes/noteOrganizer";
import { getSupabase, supabaseConfig } from "@/services/supabase";

const FUNCTION_NAME = "notes-organize";
const NOTE_PREVIEW_CHARS = 2_000;

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function parseNoteOrganizationResponse(body: unknown): NoteOrganizationPlan {
  const root = recordOf(body);
  if (!root) throw new Error("The note organizer returned an invalid response.");

  const titles: NoteTitleSuggestion[] = Array.isArray(root.titles)
    ? root.titles.flatMap((entry) => {
        const row = recordOf(entry);
        const noteId = row?.noteId;
        const title = row?.title;
        return typeof noteId === "string" && typeof title === "string" && title.trim()
          ? [{ noteId, title: title.trim().slice(0, 120) }]
          : [];
      })
    : [];

  const existingGroupAssignments: ExistingGroupAssignment[] = Array.isArray(root.existingGroupAssignments)
    ? root.existingGroupAssignments.flatMap((entry) => {
        const row = recordOf(entry);
        return typeof row?.noteId === "string" && typeof row?.groupId === "string"
          ? [{ noteId: row.noteId, groupId: row.groupId }]
          : [];
      })
    : [];

  const newGroups: NewNoteGroupSuggestion[] = Array.isArray(root.newGroups)
    ? root.newGroups.flatMap((entry) => {
        const row = recordOf(entry);
        const name = row?.name;
        const noteIds = strings(row?.noteIds);
        return typeof name === "string" && name.trim() && noteIds.length >= 3
          ? [{ name: name.trim().slice(0, 120), noteIds }]
          : [];
      })
    : [];

  return { titles, existingGroupAssignments, newGroups };
}

export const noteOrganizerApi: NotesOrganizerApi = {
  async organize(notes: readonly Note[], groups: readonly NoteGroup[]) {
    const client = getSupabase();
    if (!client || !supabaseConfig) throw new Error("This build has no sign-in configuration.");
    const { data } = await client.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error("Sign in to organize notes.");

    let response: Response;
    try {
      response = await fetch(`${supabaseConfig.url}/functions/v1/${FUNCTION_NAME}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: supabaseConfig.publishableKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          notes: notes.map((note) => ({
            id: note.id,
            text: note.text.slice(0, NOTE_PREVIEW_CHARS),
            title: note.title,
            groupId: note.groupId,
          })),
          groups: groups.map((group) => ({ id: group.id, name: group.name })),
        }),
        signal: AbortSignal.timeout(25_000),
      });
    } catch (error) {
      throw new Error("Couldn't organize notes right now. They'll stay saved and can be retried later.", { cause: error });
    }

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const fields = recordOf(body);
      const message = typeof fields?.error === "string" ? fields.error : "Couldn't organize notes right now.";
      throw new Error(message);
    }
    return parseNoteOrganizationResponse(body);
  },
};
