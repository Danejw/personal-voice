# Windows Accessibility Inspector (experimental)

This is a manual, read-only UI Automation proof of concept, not a continuous activity tracker.

## Try it

Run the Windows Tauri app with `pnpm tauri dev`. Open Assistant. Click **Inspect active app**, then focus a control in another Windows application while Settings hides briefly. The returned panel displays the foreground window title, accessible control name and class, and up to 4,096 characters from that control's UI Automation TextPattern, if exposed.

The tool does not capture screenshots, type, click, automatically scan, retain a history, upload to Supabase, or attach the result to Gemini. Clearing the result removes it from the UI. Protected UIA password elements have their contents blocked; this is not an exhaustive guarantee of sensitive-data redaction. Avoid inspecting passwords or personal information during testing.

## Limitations

UIA coverage varies across programs, editor versions, web views, privileges, and custom controls. The focused control may not expose TextPattern. Metadata-only is a valid result. The inspector must run on Windows; Android is unaffected. User-triggered screenshots and supervised computer actions already exist as separate capabilities.

## Next phases

1. Add explicit context attachment to Gemini only after user review and sensitive-content filtering.
2. Implement per-app allow/deny controls, transparent collection status, and local-only opt-in session history.
3. Add encrypted cloud synchronization with deletion/retention controls and a schema migration, only after separate consent.
4. Build UIA action planning with human confirmation, foreground verification, and bounded control operations.

Do not enable silent background collection or automatic cloud upload by default.
