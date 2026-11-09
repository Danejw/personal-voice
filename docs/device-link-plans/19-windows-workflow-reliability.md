# Windows Computer Use: bounded, verified file workflows

## Goal
Close concrete gaps observed while translating the 10-task autonomy benchmark into supported Windows actions. This is an enhancement to the existing Windows Computer Use executor, not a replacement agent, new provider, or general filesystem/shell tool.

## Existing implementation and changes
- The local, user-started visual Computer Use loop previously allowed eight actions or 45 seconds. It now permits **20 steps or three minutes**. The signed remote Computer Use limit remains 240 steps or 30 minutes. Existing Stop, confirmation, timeouts, interception and desktop ownership checks remain unchanged.
- Expand only the **fixed, native Windows allowlist** with Save (Ctrl+S), Save As (Ctrl+Shift+S), Open file (Ctrl+O), Find (Ctrl+F), address-bar focus (Ctrl+L), New tab (Ctrl+T), and Switch window (Alt+Tab). These are validated in TypeScript and mapped to hard-coded SendInput key sequences in Rust. Arbitrary hotkeys, shell, print, delete, submit and credentials stay blocked. The explicit Live press_shortcut tool still requires confirmation. Trusted no-prompt remote commands are **not** widened.
- A typed-text command no longer states text reached the editor when Android/Windows cannot identify the receiving application. The tool returns a precise attempted-but-unverified result for the visual agent to inspect on the next screenshot.
- The existing independent final screenshot checker now treats a Save-key acknowledgement, unsaved editor text, and a dismissed Save dialog as insufficient proof that a file was written. It requires visual evidence of the exact **reopened** document and requested contents. Even then, visual verification is weaker than a native disk read, which is not added here.
- If the final independent checker returns NOT_VERIFIED after one or more completed actions, the existing loop gets **one** additional fresh-screen evidence-gathering opportunity. The new model request explicitly says not to repeat uncertain saves, clicks or submissions. It does not automatically replay actions, disable risk confirmation, or claim success when the second check fails.
- The current flight recorder and durable signed remote-worker checkpoints remain the existing authorities for Windows job evidence. No new task service or screenshot persistence is introduced.

## Hardware acceptance protocol (must run on Windows to claim benchmark success)
1. Start local Computer Use: "Open Notepad, type a test summary and save it in Documents as Personal Voice Test." It should use fixed Save and file-dialog navigation, then reopen the exact file from Documents. Verify **actual file contents** manually in Explorer/Notepad. Computer Use must not claim verified based merely on its Save keystroke.
2. "Open the same file, improve its wording, save, and reopen it." Confirm one correct file remains and the content changed; use the same file path, not a duplicate filename.
3. "Open Chrome, navigate to my Personal Voice repository, find the latest PR and copy its status into Notepad." Check correct browser tab, source URL, app switching, exact status and final document content.
4. With an ambiguous/unsaved Notepad window, ask Computer Use to save. Refuse a confirmation, close a dialog without saving, or break focus. Ensure the task reports incomplete/blocked when it cannot verify the reopened file; do not accept a fabricated success.
5. Exercise Stop during a 20-step goal, a signed remote goal interrupted by phone Wi-Fi loss, and a locked Windows desktop. Stop/revocation must take effect and must not blindly replay an uncertain action.

## Automated checks
- `pnpm check` and `pnpm eval:tools` on Windows, plus Rust check/test and Android unchanged build/tests in GitHub Actions.
- Fixed shortcut allowlist and rejection of unsafe shortcuts, unchanged trusted remote action permissions, screenshot verification recovery (one attempt only), local task cap, and truthful paste evidence all have regression coverage.
- CI's scripted tool-use cases are **not proof** that Gemini successfully navigates a real Notepad or Chrome session; real device results must be collected separately.

## Remaining work
PDF content extraction and actual on-disk document verification remain unimplemented as native tools. Tests 4, 6, 7, 8, 9 and 10 still require separate integration or hardware validation. Do not claim this change passes the 10-task benchmark by itself.
