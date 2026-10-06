# PV32 — Smart Notes organization

## Goal

Replace the flat Notes inbox with a visual workspace that stays easy to scan as the note count grows.

## Implemented behavior

- Every saved Note may have one stable concise title.
- AI generates a title only while `notes.title` is null. Normal organization never rewrites an existing title.
- Manual title edits set `title_source = 'manual'` and are not replaced by AI.
- `note_groups` are reusable account-scoped sections.
- AI prefers an existing group and leaves ambiguous notes ungrouped.
- AI may create a new group only when at least three currently ungrouped notes form a clear shared topic/project.
- Manual note moves set `group_source = 'manual'`.
- Notes save first. AI enrichment runs afterward and cannot make a successful save fail.
- Organization results are applied only when the note's `updated_at` still matches the version the organizer analyzed.
- Existing notes are enriched in bounded batches. Previously considered ungrouped notes are reconsidered when a new unorganized note triggers another pass.

## UI

Notes are displayed as a responsive grid instead of a flat list.

A group card shows:
- group name
- note count
- up to six mini note tiles
- source marker and title for each visible note
- expandable full note cards

Ungrouped notes remain visible as normal note cards in the same grid.

Full note cards retain edit, transform, copy, archive, delete, attachment, and Assistant attachment actions. Edit mode adds manual title and group selection. Groups can be renamed.

## Backend

Migration: `20261006170000_smart_notes_organization.sql`

New server function: `notes-organize`

The function follows the existing authenticated Gemini server pattern and uses `gemini-3.5-flash-lite`. It receives bounded note previews and the user's existing groups. It returns structured title suggestions, existing-group assignments, and optional new-group clusters. It does not write the database directly.

No new transcription provider, vector database, embeddings store, background queue, or permanent client AI key was introduced.

## Privacy

Only explicitly saved Note text sent for organization leaves the client for the existing configured Gemini text provider. Microphone audio is not involved. Attachments are not sent to the organizer.

## Validation

PR validation must pass:
- `pnpm check`
- Windows `cargo check --locked`
- Windows `cargo test --locked`
