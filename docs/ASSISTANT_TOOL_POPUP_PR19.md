# PR19 — Floating Assistant Status and Quick Approvals

## User-facing behavior

On Windows, the assistant shows a small always-on-top popup during ongoing tools and when an action needs confirmation. The popup displays the action description and **Allow once / Deny**. These buttons apply only to the exact pending action ID. The main Assistant panel's original buttons remain available.

The popup also displays current computer-task activity. It never automatically approves a request. Ending the assistant closes the active progress and pending action state.

## Settings

In **Settings → Assistant**, the existing **Auto-run actions** remains available, and a new **Auto-run routine Windows controls** toggle defaults to OFF. When BOTH are enabled, the assistant can use the following reversible UI Automation operations without repeated approval:

`highlight`, `focus`, `scroll-up`, `scroll-down`, `scroll-left`, `scroll-right`, `scroll-into-view`, `expand`, `collapse`, `select`, `add-selection`, `remove-selection`, `minimize`, `maximize`, `restore`, `move`, `resize`.

**Still confirmed:** UIA `invoke`, `toggle`, `set-value`, `set-range`, `realize`, outbound camera-photo paste, and starting continuous accessibility monitoring. Existing auto-run behavior for older tool families is unchanged.

Device-scoped persistence means enabling it on Windows does not enable the option on Android or another computer.

## Manual test

1. On Windows, switch into another app and ask the assistant to perform a UIA command requiring confirmation. Confirm the floating popup appears without returning to Personal Voice.
2. Click **Deny**; verify the action does not happen. Repeat with **Allow once** and confirm only that action happens.
3. Ask for a lengthy Computer Use task and verify progress remains visible; verify the status changes to completed or failed and disappears after completion.
4. Enable both Auto-run toggles; test focus and scroll actions. Confirm they skip review. Test `set-value` and `invoke` on a disposable control. Confirm they still ask.
5. Disable Auto-run actions, but leave the new toggle on; verify routine UIA actions ask again.
6. End the session during a pending approval; verify the popup disappears and stale approval cannot be used.
7. Test on multiple monitors, minimized main app, and after tray launch.
8. Run Windows TypeScript, Rust compilation and tests, plus Android CI. Do not merge before tests and local approval behavior pass.

## Scope

This PR is a focused interaction and permission update; it does not implement unrelated window-docking, global mouse tracking, or unbounded autonomous task execution. The popup is local to the Windows app, not an external chat message or mobile push notification.
