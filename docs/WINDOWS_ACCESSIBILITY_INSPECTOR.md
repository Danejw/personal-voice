# Windows Accessibility Inspector (experimental)

This is a manual, read-only UI Automation proof of concept, not a continuous activity tracker.

## Try it

Run the Windows Tauri app with `pnpm tauri dev`. Open Assistant. Click **Inspect active app**, then focus a control in another Windows application while Settings hides briefly. The returned panel displays the foreground window title, accessible control name and class, and up to 4,096 characters from the focused control and a bounded set of its descendants (at most 160 elements, depth 7), using accessible names, TextPattern and ValuePattern when available.

The inspector does not capture screenshots, type, click, scan in the background, or automatically upload to Supabase. **Attach to Assistant** explicitly passes the inspected text into the current Gemini conversation, which can be persisted by the existing Assistant conversation history. Gemini can also invoke the on-demand `inspect_active_app` tool when the user asks about the active application, returning the observed text directly as a tool result. Clearing a local preview does not delete any context already attached to a conversation. Protected UIA password elements have their contents blocked; this is not an exhaustive guarantee of sensitive-data redaction. Avoid inspecting passwords or personal information during testing.

## Limitations

UIA coverage varies across programs, editor versions, web views, privileges, and custom controls. The focused control may not expose TextPattern. Metadata-only is a valid result. The inspector must run on Windows; Android is unaffected. User-triggered screenshots and supervised computer actions already exist as separate capabilities.

## Next phases

1. Improve sensitive-content filtering and per-app allow/deny controls, including stronger safeguards before model tools inspect private apps.
2. Add transparent collection status and opt-in local-only session history.
3. Add encrypted cloud synchronization with deletion/retention controls only after separate consent.
4. Build UIA action planning with human confirmation, foreground verification, and bounded control operations.

Do not enable silent background collection or automatic cloud upload by default.
