# ASSISTANT BUILD ORDER 15 — Final Integration + Architecture Audit

## BRANCH + GROUND TRUTH

Before changing code:

1. Run `git branch --show-current`.
2. The implementation branch must be `assistant`.
3. If the current branch is not `assistant`, STOP. Do not modify `main` and do not switch branches without the user doing so.
4. Read `AGENTS.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/BACKEND_SYNC.md`, and `docs/PV-Phases/README.md`.
5. Read every prior report in `docs/Assistant-Phases/`.
6. Inspect the current code paths you will touch. The local `assistant` branch is truth.

Preserve working Windows and Android dictation.


## GOAL

Do not add another headline feature.

Audit, simplify, test, and document the complete Assistant system while preserving the production Dictation path.

Expected product shape:

```text
Personal Voice
├── Dictation
│   └── Gemini 3.5 Transcribe Live
└── Assistant
    ├── Gemini 3.8 Live conversation
    ├── interruption + resumption
    ├── quick access
    ├── selection context
    ├── safe tools
    ├── Search grounding
    ├── screen context
    ├── notes/handoffs context
    ├── cross-device continuation
    ├── remote device context
    ├── personal context/profile
    └── supervised computer actions
```

## ARCHITECTURE AUDIT

Inspect for:
- Assistant semantics leaking into `DictationController`
- duplicated microphone/audio pipelines
- provider wire types escaping provider boundaries
- platform-specific logic outside `PlatformAdapter`/native platform code
- permanent Google credentials in clients
- tokens logged/persisted
- microphone/screenshot persistence
- stale async/session callbacks
- unbounded conversations/context
- tools bypassing validation/confirmation
- cross-account device access
- remote action ownership bugs
- unnecessary permissions/packages
- intermediate-phase dead code
- duplicated services/stores
- Assistant failures affecting Dictation
- tray/background/floating-control regression
- Android lifecycle failures

Remove obsolete scaffolding only when replacement behavior is covered by tests.

## SESSION/COST SANITY

Confirm:
- context-window compression is used appropriately
- session resumption is correct
- duplicate screenshots are not resent unnecessarily
- Search is not forced on all turns
- context/profile packages are bounded
- remote calls have timeouts
- computer-action loops have hard limits

## UX SANITY

A user should always understand:
- Dictation vs Assistant
- when mic is listening
- when Assistant is speaking/responding
- attached context
- Search sources
- pending confirmation
- targeted remote device
- how to Stop immediately

Do not surface provider-debug noise in normal UI.

## DOCS + TESTS

Run the full repository check suite and platform-appropriate builds.

Update current product docs where they are now stale:
- `docs/SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/BACKEND_SYNC.md`
- `docs/Assistant-Phases/README.md`

Do not rewrite historical phase reports.

## REQUIRED IMPLEMENTATION REPORT

When complete, create `docs/Assistant-Phases/15-assistant-final-audit.md` and update `docs/Assistant-Phases/README.md`.

Record the goal, starting state, exact implementation, files changed, model/API/config, schema changes, platform behavior, automated tests/results, manual test procedure, limitations, and next-phase boundary. The report is the permanent truth; do not claim unbuilt behavior.


# MANUAL ACCEPTANCE TEST — FINAL

1. Windows Dictation inserts text.
2. Android Dictation inserts text.
3. Start Assistant through quick access.
4. Hold a multi-turn spoken conversation.
5. Interrupt Gemini while it speaks.
6. Capture selected text and ask about it.
7. Create a Voice Note through an Assistant action.
8. Ask a current question and verify Search sources.
9. Capture a screen and ask two visual follow-ups.
10. Continue an Assistant task to the second device.
11. From one device request read-only context from the other.
12. Ask a question that uses an analytics-derived profile fact.
13. Run one harmless supervised computer action.
14. Stop the action/session.
15. Immediately return to normal Dictation.

PASS only if all work without cross-mode confusion and Dictation remains reliable.

After writing the report, STOP.
