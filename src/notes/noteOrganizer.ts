import type { Note } from "@/notes/note";
import type { NoteGroup } from "@/notes/noteGroup";

export interface NoteTitleSuggestion {
  noteId: string;
  title: string;
}

export interface ExistingGroupAssignment {
  noteId: string;
  groupId: string;
}

export interface NewNoteGroupSuggestion {
  name: string;
  noteIds: string[];
}

export interface NoteOrganizationPlan {
  titles: NoteTitleSuggestion[];
  existingGroupAssignments: ExistingGroupAssignment[];
  newGroups: NewNoteGroupSuggestion[];
}

export interface NotesOrganizerApi {
  organize(notes: readonly Note[], groups: readonly NoteGroup[]): Promise<NoteOrganizationPlan>;
}
