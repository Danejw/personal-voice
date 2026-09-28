# BUILD ORDER 09 — PV6: Selection Capture

## Goal
Implement **PV6 — Selection Capture**.

Extend the existing platform boundary so Personal Voice can intentionally retrieve highlighted text from another application.

Create a shared representation approximately like:

```ts
ContextItem {
  type: "selection"
  text: string
  sourceApp?: string
  capturedAt: string
}
```

### Windows
Use the smallest reliable method. A temporary copy operation is acceptable:

```text
preserve clipboard
Ctrl+C
read selected text
restore clipboard
```

Do not destroy existing clipboard contents.

### Android
Use the existing AccessibilityService only where Android legitimately exposes selected/focused editable text. Do not turn AccessibilityService into general screen scraping.

Expose a simple UI to capture and preview the selection. No AI transformation yet.

Test Cursor/VS Code, browser text, basic editors, and Android-supported fields. Stop after PV6.
