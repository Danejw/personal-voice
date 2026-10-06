# Snippets

## Goal

Snippets let a user save a short trigger phrase that expands into a longer block of text.

The feature is for information the user repeatedly types or dictates, such as:

- standing instructions
- URLs
- contact details
- signatures
- repeated prompts
- project boilerplate
- frequently used responses

Examples:

```text
Voice trigger: read only mode

Expanded text:
Read-only investigation only. Do not make changes, spend credits, alter the database,
or modify production state. Investigate first and report the cause and recommended fix.
```

```text
Voice trigger: my LinkedIn

Expanded text:
https://www.linkedin.com/in/example
```

The user says only the short trigger. Personal Voice inserts the saved expansion.

## Core behavior

Snippets are deterministic text expansion, not an AI rewrite.

```text
hold Dictate
→ say "read only mode"
→ Gemini finalizes "Read only mode."
→ SnippetResolver normalizes the utterance
→ exact trigger match
→ replace the trigger with the saved snippet text
→ deliver the expanded text to the selected destination
```

If no snippet matches, dictation continues normally.

No additional model call is required for snippet expansion.

## Matching rules

V1 should favor safety over aggressive matching.

A snippet expands only when the entire finalized utterance matches one saved trigger after lightweight normalization.

Normalization should:

- trim leading/trailing whitespace
- collapse repeated whitespace
- compare case-insensitively
- ignore ordinary trailing sentence punctuation added by transcription, such as `.`, `?`, `!`, `,`, `;`, or `:`

Examples:

```text
Saved trigger: read only mode

"read only mode"     → match
"Read Only Mode."    → match
"read   only mode"   → match
"use read only mode" → no match
"read only"          → no match
```

Do not use fuzzy semantic matching in V1. A near match must remain ordinary dictation rather than expanding the wrong snippet.

Trigger names must be unique per account after normalization.

## Data model

Snippets should be account-synced so the same triggers are available on Windows and Android.

Suggested table:

```text
snippets
id
user_id
trigger
content
enabled
created_at
updated_at
```

Suggested constraints:

- trigger is required
- content is required
- one normalized trigger per user
- disabled snippets never match
- trigger length stays small enough to be a practical spoken phrase
- content may hold long instructions or links

Only server-confirmed snippet data should be cached locally. Cached snippets may still expand while offline. Creating, editing, deleting, or enabling/disabling a snippet requires sync. No offline mutation queue is needed.

## Dictation pipeline

Snippet resolution belongs after final transcription and before destination delivery.

```text
microphone
→ Gemini 3.5 Transcribe Live
→ finalized transcript
→ SnippetResolver
   ├─ exact snippet match → saved expansion
   └─ no match → original transcript
→ optional post-processing
→ destination
```

Snippet expansion should be shared product logic and should not live inside the Gemini provider or platform-specific code.

### Interaction with Transform profiles

A matched snippet is already user-authored final text. Automatic Dictation transforms should not silently rewrite it.

Recommended V1 order:

```text
final transcript
→ resolve snippet
   ├─ snippet matched → deliver saved snippet text directly
   └─ no snippet → optional selected Transform → deliver
```

This preserves exact URLs, legal language, signatures, and standing instructions.

A user can still manually transform snippet output later from Notes, History, or another transform-enabled surface.

## Live field preview

While the user is speaking, the existing live preview can continue showing the recognized trigger words.

Example:

```text
while speaking:  read only mode
on release:      Read-only investigation only. Do not make changes...
```

On a successful snippet match, the final commit replaces the provisional trigger text with the snippet expansion once.

No partial transcript should be interpreted as a snippet before finalization.

## Destinations

Because snippet resolution occurs before destination delivery, the same voice trigger works with the existing Dictation destinations.

Examples:

```text
Active field
"my LinkedIn"
→ pastes the saved URL into the focused field

Note
"project instructions"
→ creates a note containing the saved instructions

Remote Dictation
"read only mode"
→ sends the expanded instructions to the selected device
```

The destination receives the expanded text, not the trigger phrase.

## Snippets UI

Add a Snippets section under the Voice area.

The page should allow the user to:

- create a snippet
- edit its trigger
- edit its expansion text
- enable or disable it
- copy the expansion
- delete it
- see the normalized trigger that will be recognized when useful

A simple editor is enough:

```text
Trigger
read only mode

Expansion
Read-only investigation only. Do not make changes...

[ Save snippet ]
```

Existing snippets can be shown as compact cards:

```text
read only mode
Read-only investigation only. Do not make changes...

my LinkedIn
https://www.linkedin.com/in/example
```

Avoid model settings, regex rules, variables, scripting, or automation controls in V1.

## Manual recall

Voice is the primary recall path, but saved snippets should also be useful without speaking.

From the Snippets page, the user should be able to copy an expansion directly. A later iteration may add Insert into active field if it fits the existing focus-restoration behavior cleanly.

## Error and conflict behavior

- Duplicate trigger: reject the save with a clear message.
- Empty trigger or content: reject the save.
- Disabled snippet: treat as no match.
- Sync unavailable: cached snippets remain usable for expansion, but editing is read-only.
- Snippet expansion itself cannot fail once a cached match exists because it is a local string replacement.
- Destination failure follows the existing Dictation error/recovery behavior.
- If the snippet store has not loaded yet, Dictation must not guess. Treat the utterance as ordinary dictation.

## Privacy

Snippet content is explicit account data, similar to saved Notes and custom Transform profiles.

- no microphone audio is stored
- only the saved trigger and expansion text sync
- snippet content is never sent to an AI model merely to expand it
- snippet content goes to a model only if the user explicitly performs a separate feature that requires one, such as a manual Transform or Assistant action

## Suggested shared types

Conceptually:

```ts
interface Snippet {
  id: string;
  trigger: string;
  content: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SnippetResolver {
  resolve(finalTranscript: string): {
    matched: boolean;
    text: string;
    snippetId?: string;
  };
}
```

The exact implementation may use functions instead of an interface if that stays simpler.

## V1 acceptance criteria

A complete first version should satisfy all of the following:

1. User can create, edit, enable/disable, and delete account-synced snippets.
2. Windows and Android load the same snippet set for the signed-in account.
3. Saying a saved trigger as the entire utterance expands to the saved content.
4. Matching is deterministic and tolerant only of case, whitespace, and trailing punctuation.
5. Saying the trigger inside a longer sentence does not expand it.
6. Disabled snippets do not expand.
7. Normal dictation is unchanged when no snippet matches.
8. A matched snippet bypasses an automatic Dictation Transform so the saved text remains exact.
9. Active field live preview shows speech normally and commits the expansion only after finalization.
10. Existing destinations receive the expanded text without needing separate snippet-specific destination code.
11. Cached server-confirmed snippets can still expand while offline.
12. No new transcription provider or AI model is introduced.

## Out of scope for V1

- fuzzy or semantic trigger matching
- inline snippet replacement inside a longer sentence
- variables such as date/name/placeholders
- nested snippets
- regex triggers
- scripting
- conditional snippets
- shared/team snippet libraries
- automatic AI generation of snippet content
- snippet marketplaces

These can be reconsidered only after exact whole-utterance expansion proves useful and reliable.
