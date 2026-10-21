# Clipboard history

Clipboard history is part of Selection. It keeps the last 20 things you copy and syncs them to your account. It does not replace the system clipboard on other devices.

## How it works

History lives on **Selection**, under the current selection preview. There are no clipboard switches to set.

- Copies are saved on this computer and synced to the signed in account.
- Text, links, and images are saved.
- Only the last 20 copies are kept. Older copies are removed.
- Another computer can copy an item onto its own clipboard. Sync never pastes or overwrites the other computer's current clipboard.
- Copies Windows marks as private are not read. Personal Voice does not choose apps to skip.

Clipboard contents are not written to logs, analytics, or error reports.

## Windows

A clipboard format listener wakes when another app copies. It does not poll. Ctrl+C and application copy commands keep working. Personal Voice only reads the clipboard after it changes.

Writes this app makes itself (dictation paste, selection restore, and copying an item out of history) are ignored, so they are not saved again. Copying the same thing twice in a row does not create a second row. Copying an older item again moves that row up and counts the reuse.

**Copy selection** on the same page captures the highlighted text and leaves it on the clipboard. That text is saved to history too. **Clear** on the preview only clears that capture. **Clear history** deletes saved copies.

The floating control has a selection history button. A shortcut can be recorded under Devices & Controls as **Open selection history**. Either one opens Selection and focuses the history search.

## Sync

History is cached on the device and syncs when the account is reachable. A delete on one computer removes the item on the others. **Clear history** permanently deletes the account's clipboard history and its images.

Images are stored locally as PNG and uploaded to a private `clipboard-images` bucket under the signed in user. Row access is limited to that user. Images already saved as BMP still open and copy normally.

On Windows, an image copy with no text is saved, including a Snipping Tool region copy. The image is kept as PNG, so a normal snip does not need megabytes of raw bitmap storage. Copying an image out of history puts a bitmap back on this computer's clipboard for other apps to paste.

## Android

Android can show synced history and copy text back while the app is open. It does not watch the clipboard in the background. **Copy selection** still copies the focused field's selection onto the Android clipboard.
