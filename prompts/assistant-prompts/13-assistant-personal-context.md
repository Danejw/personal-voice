# ASSISTANT BUILD ORDER 13 — Personal Context + Analytics-Derived Profile

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

Create one controlled Personal Context layer so Assistant can use what Personal Voice legitimately knows without dumping all user data into every Gemini session.

Potential sources:
- current device identity
- current/target app
- explicitly attached selection
- active screenshot
- selected Notes/Handoffs
- Personal Dictionary
- analytics aggregates
- deterministic usage preferences

## CONTEXT PROVIDER

Create a small application-level boundary such as:

```text
ContextProvider
→ available sources
→ allowed/relevant sources
→ bounded context package
→ Assistant
```

Gemini provider code must not directly query random Supabase tables.

Keep source data in existing stores. Do not create a duplicate context warehouse.

## DETERMINISTIC PROFILE

Build profile facts from the existing user-facing analytics first.

Examples only when supported by data:
- `Desktop accounts for 72% of dictations`
- `Hold to Dictate is the most-used trigger`
- `Cursor is a frequent dictation target`
- `Most-used dictionary terms are ...`
- `Average WPM this month is ...`

Use meaningful thresholds. Sparse data should not produce confident claims.

The user must be able to inspect the profile/context available to Assistant and disable its use.

Do not infer sensitive traits from behavior.

## ASSISTANT USE

The Assistant may use these facts to improve workflow/helpfulness, but must not invent profile information absent from the context package.

Keep the package bounded.

Do not add embeddings/vector storage unless a concrete retrieval problem proves structured retrieval insufficient.

## TESTS

Cover threshold logic, opt-out, bounding, correct source use, stale analytics, and no source duplication.

## REQUIRED IMPLEMENTATION REPORT

When complete, create `docs/Assistant-Phases/13-assistant-personal-context.md` and update `docs/Assistant-Phases/README.md`.

Record the goal, starting state, exact implementation, files changed, model/API/config, schema changes, platform behavior, automated tests/results, manual test procedure, limitations, and next-phase boundary. The report is the permanent truth; do not claim unbuilt behavior.


# MANUAL TEST — PHASE 13

1. Open the Personal Context/Profile view.
2. Inspect the facts Personal Voice says it knows.
3. PASS if each can be traced to actual existing analytics/data.
4. Ask: `Which device do I use Personal Voice on the most, based on my analytics?`
5. PASS if Assistant answers from actual profile data.
6. Disable profile/analytics context for Assistant.
7. Ask the same question in a new session.
8. PASS if Assistant no longer claims access to that disabled profile fact.

STOP after this phase.
