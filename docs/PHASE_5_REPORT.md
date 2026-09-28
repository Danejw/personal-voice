# Phase 5 implementation report — dictionary and settings sync

## Scope

Only `prompts/05-sync.md`: Supabase tables with RLS for devices, dictionary, and settings; a personal dictionary fed to Gemini's custom vocabulary; synced Smart transcription and language settings; load on sign-in, save on change, and a local cache. There is no realtime sync, no offline write queue, no Android work, and no transcript storage.

## Gemini custom vocabulary

Checked on 2026-09-27 against [Live transcription](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe). The setup message's `inputAudioTranscription.customVocabulary` takes a list of strings: up to 1,000 terms, with best results at about 100. Each utterance opens its own Live session, so the vocabulary is read when the user presses the shortcut, and an edit applies from the next utterance. The ephemeral token locks only the model (`fieldMask: "model"`), so the client's vocabulary, mode, and language are accepted.

## Database

Migration `supabase/migrations/20260927230000_personal_sync.sql`, applied to project `dlovrtlkniolcovfgvvj` as `personal_sync`:

| Table | Columns | Rules |
| --- | --- | --- |
| `devices` | `id`, `user_id`, `name`, `platform`, `last_seen`, `created_at` | `platform` is `windows` or `android` |
| `dictionary` | `id`, `user_id`, `term`, `enabled`, `created_at`, `updated_at` | Unique per user, case-insensitive. Trimmed, 1–100 characters. At most 200 per user (trigger). |
| `settings` | `user_id` (primary key), `smart_transcription`, `language`, `updated_at` | `language` is BCP-47 or `null` (automatic) |

No `profiles` table, because nothing needs it. Each table has RLS with one owner-only policy. `anon` has no access.

## Sync behavior

| Moment | What happens |
| --- | --- |
| Sign-in or app start | The cached copy for this account shows at once, then settings and dictionary load from Supabase and replace it. The device row is upserted with a stable per-account id and a new `last_seen`. |
| Edit | The UI updates immediately. Writes go to Supabase in order. On success, the cache is updated. |
| Failed write | An error is shown, and the view rolls back to the last server-confirmed copy while keeping edits still in flight. Dictation is not blocked. |
| Supabase unreachable at load | The cached copy is used, read-only, with a Retry button. Dictation keeps using the cached vocabulary and settings. |
| Sign-out or account switch | The view clears. Late responses for the previous account are dropped. |

Curation rules: at most 100 active terms (the client refuses to enable or add past that), 200 total, and no case-insensitive duplicates. Whitespace inside a term is collapsed.

Synced settings are Smart transcription and language. The push-to-talk shortcut stays local.

Editing an existing term's text was left out. Deleting and re-adding covers it, and it would have added UI without much benefit.

## Changes

- `supabase/migrations/20260927230000_personal_sync.sql`: the schema above.
- `src/types/database.ts`: generated Supabase types. `src/services/supabase.ts` now returns a typed client.
- `src/services/personalSyncService.ts`: typed reads and writes, and a mapping from Postgres errors to user-facing messages.
- `src/sync/personalData.ts`: the data model, limits, term rules, language list, and `transcriptionPreferences()`.
- `src/sync/personalCache.ts`: the per-account cache and local device id, validated on read.
- `src/sync/PersonalSyncStore.ts` and `usePersonalSync.ts`: the store and its React binding.
- `src/sync/TranscriptionSettingsPanel.tsx` and `DictionaryPanel.tsx`: the UI. `app.css` has their styles, and the term list uses the shared `hide-scrollbar` class.
- `src/voice/provider/VoiceProvider.ts`: provider-neutral `TranscriptionPreferences`. `GeminiProvider.ts`: `geminiConfigFrom()`.
- `src/platform/PlatformAdapter.ts`: a `platform` name for device records. The Windows adapter reports `"windows"`.
- `src/auth/useAuth.ts`: exposes `userId`.
- `src/app/App.tsx`: new Transcription and Personal dictionary sections. Each utterance's provider is built from the synced data.
- Every file edited in this phase now uses `@/` imports.
- Docs: `ARCHITECTURE.md` and `BACKEND_SYNC.md`. The stale allowlist mention was removed.

## Checks

| Check | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck` | PASS |
| `pnpm test` | PASS, 9 files / 80 tests. New tests cover load and cache, the offline cached copy and retry, persistence across a restart, immediate edits, rollback on a failed write, curation limits, the vocabulary and settings sent to Gemini, the device record, the account-switch race, cache validation, and error mapping. |
| `pnpm build` | PASS |
| RLS, run live with two temporary users | User B can't read, update, or delete user A's rows. Inserting a row for another user is refused. `anon` gets permission denied. Temporary rows were deleted afterwards. |
| Constraints, run live | A case-only duplicate, an untrimmed term, and an invalid language code are each rejected. |
| Supabase security advisor | No findings for the new tables. One existing Auth warning: leaked-password protection is off (Dashboard → Authentication → Passwords). |

Rust was not changed.

## Not yet verified (needs you)

These acceptance criteria depend on live dictation, which still waits on the Phase 4 end-to-end test (`GEMINI_API_KEY` secret, a confirmed account):

1. Sign in. Turn Smart transcription off, pick a language, and add a few terms (for example `Persyn`, `UFIQ`, `model_pricing_skus`). Turn one off.
2. Restart the app. Everything should reload the same. Sign out and back in, and it should reload again.
3. In the Supabase table editor, rows in `settings`, `dictionary`, and `devices` should match.
4. Dictate a sentence with an active term. It should be spelled as in the dictionary. Say a turned-off term and compare.
5. Push-to-talk dictation into another app should work as in Phase 3.

Phase 5 is **not complete** until these pass.
