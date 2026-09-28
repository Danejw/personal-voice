# Phase 2 implementation report — Windows system-wide dictation

## Scope

Only `prompts/02-windows-dictation.md`: global push-to-talk, a minimal indicator, insertion into the focused app via clipboard + paste with clipboard restore, a system tray, and cancel/error handling. No Supabase, Android, dictionary sync, updater, extra providers or assistant features. Launch-at-login is not in the Phase 2 list, so it is not implemented.

## Changes

Rust (`src-tauri/src`):

- `platform/windows/push_to_talk.rs`: shortcut grammar and a pure key-matching state machine. It ignores auto-repeat, requires exact modifiers, routes Escape to cancel only while active, and passes everything through while paused. 6 unit tests.
- `platform/windows/hook.rs`: `WH_KEYBOARD_LL` hook on its own message-loop thread. Events are forwarded through a channel, so the hook callback stays fast.
- `platform/windows/insert.rs`: clipboard snapshot, then set text, then Ctrl+V, then conditional restore.
- `platform/windows/mod.rs`: Windows surface. Includes the no-activate indicator show and hide.
- `platform/mod.rs`: the platform selector. Non-Windows targets get "unsupported" stubs, so Android still compiles.
- `commands/mod.rs`: IPC commands `insert_text`, `set_push_to_talk_shortcut`, `set_dictation_active`, `show_indicator`, `hide_indicator`.
- `tray.rs`: Open Settings, Pause Dictation (check item), Quit. Left-clicking the tray icon opens Settings.
- `lib.rs`: wires the tray, indicator placement (bottom-centre of the primary work area, click-through), the hook, close-to-tray and the commands.
- `Cargo.toml`: Tauri `tray-icon` feature. `serde =1.0.229` and `windows =0.62.2` were already in the lockfile, so no new crates.
- `tauri.conf.json` / `capabilities/default.json`: `indicator` window, WebView2 flags on both windows, and `core:event:default` for both.

TypeScript (`src`):

- `platform/PlatformAdapter.ts`: the boundary as implemented. See `docs/ARCHITECTURE.md`. Capture stays shared and is not on the adapter.
- `platform/windows/WindowsPlatformAdapter.ts`, `platform/index.ts`: the IPC bridge and the single adapter factory.
- `voice/session/state.ts`: `cancel` action (CONNECTING/LISTENING/FINALIZING go to IDLE; INSERTING cannot cancel). The reducer switch is now exhaustive.
- `voice/session/DictationController.ts`:
  - The final transcript goes to INSERTING, then `insertText`, then IDLE.
  - If insertion fails, the state is ERROR and the transcript stays visible.
  - Adds `cancel()` and `press()`; `press()` resets from ERROR, so a failure never blocks the next utterance.
  - Adds an `utterance` counter.
- `voice/session/indicator.ts`: maps lifecycle state to the indicator.
- `settings/pushToTalk.ts`: shortcut presets, stored locally until Phase 5 sync.
- `app/useDictation.ts`: push-to-talk and pause subscriptions, plus indicator and Escape sync. An error indicator auto-hides after 4 s.
- `app/App.tsx`, `app/Indicator.tsx`, `main.tsx`, `app/app.css`: settings UI and the indicator view. Both windows load one bundle and pick their view by window label.
- `voice/provider/gemini/GeminiProvider.ts`: key and production checks moved into `createSession`, so a missing key during push-to-talk becomes a controlled ERROR instead of a thrown exception.
- `package.json`: `@tauri-apps/api` `2.12.0` (exact, matching the Rust `tauri` version).

## Reliability requirements

| Requirement | How |
| --- | --- |
| Repeated keydown creates one session | Hook `held` flag swallows auto-repeat (Rust test). Controller `start` is a no-op unless IDLE (TS test). |
| One utterance inserts once | Only the first final while FINALIZING is delivered (TS tests: duplicate finals, one insert). |
| No stale transcript into the next session | Events are ignored unless they come from the current session; cancel and release detach the session (TS tests: late final after cancel, old session's final during a new utterance). |
| Focus change while speaking | Paste goes to the window focused at insertion time. The indicator never takes focus (verified). |
| Clean cancel/error | Escape cancels before insertion. Tray pause cancels. Errors show on the indicator for 4 s and the next press starts fresh. |

## Checks

| Command | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck` | PASS |
| `pnpm test` | PASS, 4 files / 28 tests |
| `pnpm build` | PASS; the dev key UI is absent from the bundle |
| `cargo fmt --check`, `cargo clippy --all-targets -D warnings` | PASS (only the known exFAT incremental-cache notice) |
| `cargo test` | PASS, 6 tests |
| `cargo check --target aarch64-linux-android` | PASS |
| `pnpm tauri dev` smoke, with a synthetic Right Alt press/release and no key | PASS: hook fired, controller entered ERROR with the missing-key message, indicator shown, foreground window unchanged, indicator hidden after the timeout, second press re-showed it |

## Manual tests (user, 2026-09-27)

The user confirmed the acceptance flow with real speech: focus a field, hold the hotkey, speak, release, and the transcript appears in the focused field. This worked in every input field they tried, without the Settings window focused. Results were reported as a whole rather than per application.

| Check | Result |
| --- | --- |
| Hold hotkey → speak → release → text inserted into the focused field | PASS |
| Works in the user's active input fields across apps | PASS (reported collectively) |
| Settings window does not need focus | PASS |
| Per-app itemization (Notepad, Chrome, Cursor/VS Code, another field) | Not itemized separately |
| Clipboard restored after dictation (text and image) | Not separately reported |
| Hotkey while Settings is hidden to the tray | Not separately reported |

## Known limitations

- **Dev key:** the development key is still typed into Settings each launch (Phase 4 replaces it). Push-to-talk without a key shows the missing-key error.
- **Elevated apps:** apps running as administrator do not receive the paste (UIPI). There is no error, because Windows doesn't report the block.
- **Clipboard restore:** metafile-only, palette-only or private-format clipboard content is not restored.
- **AltGr:** on AltGr keyboard layouts, Right Alt doesn't trigger dictation; pick another preset.
- **Quick re-press:** a press while the previous utterance is still finalizing or inserting is ignored. Phase 3 reliability can queue it.
- **Paste delay:** the 400 ms wait before restoring the clipboard is a heuristic. Very slow targets (for example, remote desktop) could paste the restored clipboard instead; tune it after manual tests.
