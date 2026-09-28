# PV6 implementation report — selection capture

Prompt: `prompts/PV-Prompts/09-PV6-selection-capture.md`

## Scope

Retrieve highlighted text from another app through the platform boundary. Shared `ContextItem`. Preview UI only; no AI transform. Prompt 08 (PV13) was skipped; this phase still ran.

## Shared type

```ts
ContextItem {
  type: "selection"
  text: string
  sourceApp?: string
  capturedAt: string
}
```

`PlatformAdapter.captureSelection()` returns that item. Settings hides, captures from the previous app, then comes back.

## Windows

Hide Settings → ~150 ms → finish any pending paste restore → snapshot clipboard → Ctrl+C → settle ~400 ms → read `CF_UNICODETEXT` → restore snapshot.

- Unchanged clipboard sequence number ⇒ “No text is selected in the other app.”
- `sourceApp` is the foreground window title.
- Clipboard history flags follow the same restore path as paste.

## Android

`moveTaskToBack` → read only the focused editable node’s selection range → bring Settings forward.

- Password fields, hint text, collapsed cursor, unknown range, and non-editable surfaces are refused.
- No screen scraping; the accessibility service still subscribes to no events.
- `sourceApp` is the node `packageName`.
- The OS clipboard is not used for capture.

## UI

**Selection** in Settings: Capture, Copy, Clear. Preview is in-memory only.

## Deviations

- VS Code/Cursor may copy the current line when nothing is highlighted (OS Ctrl+C behavior).
- Browser page highlights that are not in a focused editable field are not captured on Android (documented in `docs/ANDROID.md`).
- Live capture in Cursor, VS Code, browsers, and Android fields was not executed in the implementation session; unit tests and Kotlin `FieldSelection` tests were.

## Checks

| Check | Result |
| --- | --- |
| `eslint src`, typecheck, Vitest | PASS (including `ContextItem` / UTF-16 helpers) |
| `cargo test` insert UTF-16 helpers, Clippy `-D warnings` | PASS |
| Android `TextSplice` / `FieldSelection` unit tests | PASS |

## How to confirm quickly

**Windows:** Highlight text in Notepad or a browser → Settings → **Selection** → Capture selection → preview matches; your previous clipboard is restored.  
**Android:** Select text in a focused text field in another app → Capture. Password/empty selection should error; a web-page-only highlight may fail by design.
