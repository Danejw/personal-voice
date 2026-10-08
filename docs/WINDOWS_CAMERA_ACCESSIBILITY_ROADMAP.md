# Windows camera and accessibility roadmap (PR #15)

## Changes in this update
- Camera Context reports active after the actual video-stream initialization succeeds. On failure the desired camera state is cleared, tracks are stopped and the error is shown.
- Windows camera frames already come from `getUserMedia` with a live video track. Webcam hardware LEDs are device/driver controlled and cannot be forced on reliably by the application. A camera-active UI dot is already present; the user should validate that their particular webcam illuminates when `getUserMedia` is active.
- The existing draggable Windows floating overlay now shows an active computer-operation visual state while a supervised computer task is running. The main Assistant view already has Confirm and Stop controls. This is **not yet** a location-tracking cursor halo or full-screen bounding-box overlay.
- Added a Windows UI Automation SetFocus action gated by exact accessible-name matching, like the existing InvokePattern action. Other apps and Android remain behind their existing platform boundaries.

## Next work needed for the requested full experience
1. **Installed app discovery**: enumerate Start Menu shortcuts (per-user and shared) and packaged-app AppUserModelIDs; resolve app name ambiguities, then launch a selected app without turning a name into arbitrary shell arguments.
2. **Accessibility tree inspection**: return a bounded element tree with role, name, enabled/visible states, supported patterns, rectangles and temporary element locators scoped to the current window.
3. **Targeted actions**: validate locator + foreground window + freshness, then support Invoke, SetFocus, ScrollPattern, SelectionItemPattern, ExpandCollapsePattern, ValuePattern and window activation; never blindly reuse stale coordinates or an element from a different app.
4. **Screen feedback overlay**: independent click-through Tauri overlay tracking the active window/screen. Draw target element bounds, current action name and progress, screenshot preview when the user opts in, and always-visible Stop. Synchronize with supervised-computer and UIA tool events; don't put overlays into captured screenshots.
5. **Camera integrity**: show track readyState/device label, count actual captured frames and provide a self-preview. An LED that remains off despite live frames may be hardware-specific; don't falsely claim the application can control it.
6. **Permission policy**: user-directed local actions only; protected/password elements excluded. Require review for modifying files, sending content, system configuration changes and other consequential steps. Provide per-app exclusions and an action audit.

## Test on Windows
- Start and stop Camera Context, verify device webcam light and camera-active dot; cover permission denied.
- Start supervised computer task, verify floating indicator changes, confirm/stop in Assistant.
- Inspect and focus a known accessible control; verify wrong control name fails.
- Confirm Android still builds and no automatic cloud screen capture was introduced.
