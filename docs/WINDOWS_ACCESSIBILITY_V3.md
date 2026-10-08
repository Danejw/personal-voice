# Windows accessibility v3: capabilities, boundaries, and acceptance

## Branch and release strategy
Dedicated branch `feature/windows-accessibility-v3-pr17`, forked from v0.3.19's main.
This must be reviewed in its **own PR after PR #16 exists**; do not merge it with PR #16 or backport untested native code.

## Architecture

1. **UIA tree**: `inspect_accessibility_tree` walks the foreground control-view subtree (240 elements, nine levels). It returns exact active window title, structural element path (such as `0.3.2`), accessible name, AutomationId, ControlType, class/framework, state, bounds, available patterns, bounded text/value selection and grid dimensions. Password elements are excluded.
2. **Target validation**: `accessibility_pattern_action` takes the entire locator from the latest inspection. Native Rust resolves that structural path again and verifies window title, name, AutomationId, ControlType, non-password, and enabled state. Stale paths or unsupported patterns fail instead of guessing.
3. **Supported actions**: highlight, focus, invoke, toggle, select/add/remove, expand/collapse, scroll up/down/left/right, scroll item into view, virtualized-item realize, update ValuePattern, set numeric RangeValue with bounds checks, minimize/maximize/restore via WindowPattern, and move/resize via TransformPattern.
4. **Live event watch**: opt-in WinEvent OUTOFCONTEXT hooks for focus, foreground window, selection, text-value change categories, show/hide and structure changes. Events are debounced, local-only, and do not include text or screenshots. Stop unsubscribes; assistant session end and app exit stop monitoring.
5. **Visual feedback**: target bounding rectangles reuse the existing transparent click-through `computer-visual` window, with success and error labels. The Assistant has a searchable element browser with manual Highlight and an event history/toggle.
6. **Gemini tools**: structured inspection (with filtered results), confirmed capability action, start-watch (confirmation) and stop-watch (immediate). Existing screenshot and supervised computer controls remain available as fallbacks.

## Safety and expected limitations

- Windows UIA is not a universal automation API. A control's supported patterns depend on its provider. Custom GPU surfaces, elevated apps, secure desktop, and some Chromium/Electron controls may return partial metadata.
- Structural locators are short-lived. Never reuse across navigation or significant UI updates; rescan, match semantics and reconfirm.
- All UIA modifications require user confirmation even when automatic execution is enabled. Some UIA invoke operations can trigger irreversible actions; users should review the target carefully.
- Watcher is disabled by default. It never directly starts Gemini, sends application text, or creates memories. It emits only event categories and visible foreground window names to the local UI.
- No hidden terminal, shell access, privilege elevation, background key logging, arbitrary filesystem editing, or direct settings-mutation tools.
- Full UIA coverage is broader than any finite single release: additional interfaces (Annotation, TextEdit, ItemContainer, Spreadsheet, Drag/Drop, SynchronizedInput and custom providers) need compatibility and per-app testing before being advertised.
- Limits protect both the assistant and other apps from expensive or hung accessibility traversals.

## Manual acceptance tests (Windows)

1. Open Notepad, inspect controls, filter by editor, highlight it. Compare outline position and ensure overlay never receives focus.
2. Toggle a checkbox in an app exposing TogglePattern. Change a slider with RangeValue; invalid range must return an error.
3. In File Explorer or a list, select/add/remove items, expand a tree, scroll into view; test virtualized item if exposed.
4. Switch window, then attempt old locator. Verify action fails, rather than affecting a same-named control in another window.
5. Start live watch. Move focus and open a menu. Verify local history events and Stop. End assistant; verify monitor stops. Restart app; monitoring is off.
6. Test duplicate accessible names, password fields, screen lock, DPI and secondary monitors. Fail safely, don't silently choose.
7. Run `pnpm check`, Windows `cargo check --locked` and `cargo test --locked`, Android debug build, and Android Kotlin tests in CI. Do not merge until green.

## Planned future hardening

- RuntimeId snapshots with identity lifetime tracking and an event-triggered cache for efficient rescan (structural paths intentionally not permanent).
- UIA native event handlers for UIAutomation property/structure notifications in addition to WinEvents, per-provider compatibility and caching.
- Extended document/table manipulation including full TextPattern2 caret ranges, TextEdit, table headers, spreadsheet formulas and annotation reads.
- Shared target-intent reviews, app exclusions, and per-app capability diagnostics.
