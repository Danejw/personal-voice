import { describe, expect, it } from "vitest";
import { parseNoteOrganizationResponse } from "@/services/noteOrganizerService";

describe("parseNoteOrganizationResponse", () => {
  it("parses titles, existing assignments, and groups with at least three notes", () => {
    expect(parseNoteOrganizationResponse({
      titles: [{ noteId: "n1", title: " Release fixes " }],
      existingGroupAssignments: [{ noteId: "n1", groupId: "g1" }],
      newGroups: [
        { name: " Personal Voice ", noteIds: ["n1", "n2", "n3"] },
        { name: "Too small", noteIds: ["n4", "n5"] },
      ],
    })).toEqual({
      titles: [{ noteId: "n1", title: "Release fixes" }],
      existingGroupAssignments: [{ noteId: "n1", groupId: "g1" }],
      newGroups: [{ name: "Personal Voice", noteIds: ["n1", "n2", "n3"] }],
    });
  });

  it("rejects a non-object response", () => {
    expect(() => parseNoteOrganizationResponse(null)).toThrow("invalid response");
  });
});
