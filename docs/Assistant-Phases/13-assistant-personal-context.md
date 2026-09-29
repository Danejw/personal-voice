# Assistant 13 — Personal context

Prompt: `prompts/assistant-prompts/13-assistant-personal-context.md`

Branch: `assistant`

## Phase goal

Give Assistant one bounded personal-context package built from what Personal Voice already knows, and let the user see those facts and turn the analytics profile off.

## Starting state that mattered

Usage rollups already count dictations, triggers, target apps, dictionary-term appearances, and measured pace. Insights on the Analytics page already refuse sparse claims. Assistant already sends an attached selection, notes, one handoff, and one screenshot on their own path. There was no profile package, and no switch to keep analytics out of a Live session. Dictation was unchanged.

## What shipped

`profileFacts` reads the existing usage rows for the current month. It does not query Supabase and it does not write a second store. A fact is included only when the month's counters clear a threshold:

- Device share: at least 8 completed dictations, and one named device has at least 60%.
- Trigger: at least 8 recorded starts, and one trigger has at least 60%. The label matches the Analytics page, so the dictate shortcut is "Hold to Dictate".
- Target app: at least 5 named pastes, and one app has at least 60% of pastes.
- Dictionary terms: the leader has at least 5 uses. Up to two more terms are listed when each has at least 3.
- Pace: at least 40 measured words and 60 seconds of recording.

Rows whose newest day is more than 45 days old are ignored. Rows outside the current month are ignored. Hour-of-day and weekend patterns are not turned into facts. A removed device is not given a share sentence.

The Assistant page has a Personal context section. It shows this device and the facts above. **Use analytics profile** is on until the user turns it off. The choice is stored with this device's other local settings.

While the profile is on, a session note and each typed turn carry those lines, plus an instruction not to invent shares, triggers, apps, terms, or pace. While it is off, the same note names the device and says the analytics profile is off. The facts stay visible on the page. Attached notes, handoffs, selections, and screenshots are not copied into this package.

The Live system instruction says personal context, when a later note provides it, is the only source for this user's dictation habits.

## Files

- `src/assistant/personalContext.ts`, `personalContext.test.ts`, `PersonalContextPanel.tsx`
- `src/assistant/AssistantController.ts`, `AssistantSession.ts`, `protocol.ts`, `grounding.ts`
- `src/usage/analytics.ts` (trigger labels are now exported)
- `src/settings/deviceSettings.ts`
- `src/app/App.tsx`, `src/app/app.css`
- `docs/ARCHITECTURE.md`

## Model, API, and config

Gemini 3.8 Live is unchanged. No new tool. The token body is unchanged. No embeddings.

## Schema

None.

## Platform behavior

Windows and Android share the same page and the same package. The toggle is local to this install, like the other device preferences. Dictation, the overlay, and remote reads are unchanged.

## Tests

`pnpm check` passed: lint, tsc, and vitest (49 files, 319 tests). Coverage includes a 72% device share, a sparse month with no claim, trigger and app and term and pace lines, no hour-of-day fact, stale rows, a previous month, opt-out omitting the share, the 2,000 character clip, no Supabase or `usage_days` access in the profile module, and a session that sends the fact and then stops sending it after the profile is turned off. `pnpm build` passed. The existing chunk-size warning remains (`index-DM0lvv5A.js`, about 554 kB).

## Manual test

Not run.

1. Open Assistant and read Personal context.
2. Pass if each listed fact matches Analytics for this month, and a thin history lists no share or pace.
3. Ask: `Which device do I use Personal Voice on the most, based on my analytics?`
4. Pass if the answer uses a fact shown on that page.
5. Turn off **Use analytics profile** and start a new Assistant session.
6. Ask the same question.
7. Pass if Assistant does not claim the disabled share.

## Limitations

Facts are month totals, not a lifetime profile. A device that is no longer on the account is skipped rather than named. The profile is one note per socket, not a retrieved memory. Turning the profile off does not delete usage history. Search quota behavior from earlier phases is unchanged.

## Next phase boundary

Stop here. Do not start computer control.
