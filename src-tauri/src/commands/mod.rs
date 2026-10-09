//! IPC surface for the shared frontend's `PlatformAdapter`.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
#[cfg(windows)]
use std::sync::Mutex;
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE};

use crate::platform;

pub const INDICATOR_WINDOW: &str = "indicator";

// These fixed logical dimensions match tauri.conf.json on Windows.
#[cfg(windows)]
const POPUP_WIDTH: f64 = 440.0;
#[cfg(windows)]
const POPUP_HEIGHT: f64 = 300.0;

/// The tray and its feedback are independent HWNDs. No window-local tooltip can
/// extend past its own HWND bounds, regardless of z-index or CSS overflow.
#[cfg(windows)]
#[derive(Default)]
struct OverlayFeedbackState {
    notice: Option<String>,
    hint: Option<String>,
    hint_id: Option<String>,
}

#[cfg(windows)]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayFeedbackPayload {
    pub kind: Option<&'static str>,
    pub message: Option<String>,
}

#[cfg(windows)]
impl OverlayFeedbackState {
    fn current(&self) -> OverlayFeedbackPayload {
        if let Some(ref notice) = self.notice {
            return OverlayFeedbackPayload { kind: Some("notice"), message: Some(notice.clone()) };
        }
        if let Some(ref hint) = self.hint {
            return OverlayFeedbackPayload { kind: Some("hint"), message: Some(hint.clone()) };
        }
        OverlayFeedbackPayload { kind: None, message: None }
    }
}

#[cfg(windows)]
static OVERLAY_FEEDBACK_STATE: Mutex<OverlayFeedbackState> = Mutex::new(OverlayFeedbackState {
    notice: None, hint: None, hint_id: None,
});

/// Pin independent popups to the primary monitor's *work area*, not to the
/// dragged tray or the screen bounds under the taskbar.
/// Position relative to the monitor WORK AREA, never to the floating tray.
#[cfg(windows)]
fn popup_corner_position(
    area_x: i32, area_y: i32, area_width: i32, area_height: i32,
    width: i32, height: i32, shift_above: i32,
) -> (i32, i32) {
    // Fixed gutter leaves the default tray's 44px button column unobscured.
    // This never follows the tray when the user drags it elsewhere.
    let x = area_x + (area_width - width - 82).max(0);
    let y = area_y + (area_height - height - 16 - shift_above).max(0);
    (x, y)
}

#[cfg(windows)]
fn pin_corner_popup(app: &AppHandle, label: &str) -> Result<(), String> {
    let popup = app.get_webview_window(label).ok_or("Popup window missing")?;
    let monitor = popup.primary_monitor().map_err(|e| e.to_string())?
        .ok_or("No primary monitor available")?;
    let area = monitor.work_area();
    let scale = monitor.scale_factor().max(1.0);
    let desired_width = (POPUP_WIDTH * scale).round() as i32;
    let desired_height = (POPUP_HEIGHT * scale).round() as i32;
    let shift = if label == "overlay-feedback" {
        app.get_webview_window("assistant-tool-popup")
            .filter(|other| other.is_visible().unwrap_or(false))
            .and_then(|other| other.outer_size().ok())
            .map(|size| size.height as i32 + 12)
            .unwrap_or(0)
    } else { 0 };
    // Fixed dimensions in ordinary work areas; shrink only if the monitor
    // cannot accommodate them (including two vertically stacked popups).
    let width = desired_width.min((area.size.width as i32 - 100).max(120));
    let height = desired_height.min((area.size.height as i32 - 32 - shift).max(90));
    let (x, y) = popup_corner_position(
        area.position.x, area.position.y, area.size.width as i32, area.size.height as i32,
        width, height, shift,
    );
    let hwnd = popup.hwnd().map_err(|e| e.to_string())?;
    // The bounds are applied atomically so the popup never appears centered
    // or becomes positioned using a previous (smaller) message height.
    unsafe { SetWindowPos(hwnd, Some(HWND_TOPMOST), x, y, width, height, SWP_NOACTIVATE) }
        .map_err(|e| e.to_string())
}

#[cfg(windows)]
fn present_overlay_feedback(app: &AppHandle, payload: OverlayFeedbackPayload) -> Result<(), String> {
    let window = app.get_webview_window("overlay-feedback").ok_or("Feedback window missing")?;
    if payload.message.is_none() {
        return platform::hide_window(&window);
    }
    pin_corner_popup(app, "overlay-feedback")?;
    // The card is deliberately scrollable for longer notices. It remains
    // non-focusable and separate from the draggable tray.
    window.set_ignore_cursor_events(false).map_err(|e| e.to_string())?;
    app.emit_to("overlay-feedback", "overlay-feedback-state", payload).map_err(|e| e.to_string())?;
    platform::show_without_focus(&window)
}

/// One source-specific update. A delayed hover-leave cannot hide a new hover,
/// and a notice always takes precedence over lower-priority hints.
#[cfg(windows)]
#[tauri::command]
pub fn sync_overlay_feedback(app: AppHandle, channel: String, id: Option<String>, message: Option<String>) -> Result<(), String> {
    let mut state = OVERLAY_FEEDBACK_STATE.lock().map_err(|e| e.to_string())?;
    let value = message.and_then(|text| {
        let text: String = text.chars().take(1800).collect();
        (!text.trim().is_empty()).then_some(text)
    });
    match channel.as_str() {
        "notice" => state.notice = value,
        "clear-hints" => { state.hint = None; state.hint_id = None; },
        "hint" => {
            let id = id.filter(|id| !id.is_empty() && id.len() <= 100)
                .ok_or("Hint id is required")?;
            if value.is_some() {
                state.hint_id = Some(id);
                state.hint = value;
            } else if state.hint_id.as_deref() == Some(id.as_str()) {
                state.hint_id = None;
                state.hint = None;
            }
        }
        _ => return Err("Unknown feedback channel".into()),
    }
    let current = state.current();
    drop(state);
    present_overlay_feedback(&app, current)
}

/// Initial state recovery if the native command shows the window before its
/// WebView has attached an event listener.
#[cfg(windows)]
#[tauri::command]
pub fn get_overlay_feedback() -> Result<OverlayFeedbackPayload, String> {
    OVERLAY_FEEDBACK_STATE.lock().map(|state| state.current()).map_err(|e| e.to_string())
}


/// Sync one actionable popup for tool progress or a pending user approval.
/// Only the local main webview may call this command.
#[cfg(windows)]
#[tauri::command]
pub fn sync_assistant_tool_popup(app: AppHandle, snapshot: serde_json::Value) -> Result<(), String> {
    let popup = app.get_webview_window("assistant-tool-popup").ok_or("Assistant popup missing")?;
    let active = snapshot.get("pending").is_some_and(|v| !v.is_null())
        || snapshot.get("computerPrompt").is_some_and(|v| !v.is_null())
        || snapshot.get("activity").is_some_and(|v| !v.is_null())
        || snapshot.get("computerRunning").and_then(|v| v.as_bool()) == Some(true);
    if !active {
        popup.hide().map_err(|e|e.to_string())?;
        if app.get_webview_window("overlay-feedback")
            .is_some_and(|feedback| feedback.is_visible().unwrap_or(false)) {
            let _ = pin_corner_popup(&app, "overlay-feedback");
        }
        return Ok(());
    }
    pin_corner_popup(&app, "assistant-tool-popup")?;
    app.emit_to("assistant-tool-popup", "assistant-popup-state", snapshot)
        .map_err(|e| e.to_string())?;
    platform::show_without_focus(&popup)?;
    if app.get_webview_window("overlay-feedback")
        .is_some_and(|feedback| feedback.is_visible().unwrap_or(false)) {
        let _ = pin_corner_popup(&app, "overlay-feedback");
    }
    Ok(())
}


#[cfg(windows)]
#[tauri::command]
pub fn pointer_position() -> Result<platform::PointerPosition, String> {
    platform::pointer_position()
}

/// Inspect the actual UI element under the mouse without moving or clicking it.
#[cfg(windows)]
#[tauri::command]
pub async fn inspect_pointer_context() -> Result<platform::PointerContext, String> {
    tauri::async_runtime::spawn_blocking(platform::inspect_pointer_context)
        .await.map_err(|e| e.to_string())?
}

#[cfg(windows)]
#[tauri::command]
pub async fn capture_pointer_snapshot() -> Result<platform::SnapshotFrame, String> {
    tauri::async_runtime::spawn_blocking(platform::capture_pointer_snapshot)
        .await.map_err(|e| e.to_string())?
}

#[cfg(windows)]
#[tauri::command]
pub async fn inspect_accessibility_tree(app:AppHandle)->Result<platform::AccessibilityTreeReport,String>{
    let window=app.get_webview_window("main").ok_or("Settings window missing")?;
    window.hide().map_err(|e|e.to_string())?;
    let result=tauri::async_runtime::spawn_blocking(||{
        std::thread::sleep(std::time::Duration::from_millis(180));
        platform::inspect_accessibility_tree()
    }).await.map_err(|e|e.to_string()).and_then(|r|r);
    let _=platform::show_without_focus(&window);
    if let Ok(ref report)=result{
        if let Some(bounds)=report.nodes.iter().find(|n|n.focused).and_then(|n|n.bounds){
            visual_target(&app,bounds,"Inspecting focused control","inspect");
        }
    }
    result
}

#[cfg(windows)]
#[tauri::command]
pub async fn accessibility_pattern_action(app:AppHandle, locator:platform::AccessibilityLocator,
    action:String,text:Option<String>,number:Option<f64>)->Result<platform::AccessibilityActionResult,String>{
    let window=app.get_webview_window("main").ok_or("Settings window missing")?;
    window.hide().map_err(|e|e.to_string())?;
    let label=format!("{} · {}",action,locator.name);
    // Foreground focus is validated again inside the actual UIA operation.
    let result=tauri::async_runtime::spawn_blocking(move||{
        std::thread::sleep(std::time::Duration::from_millis(150));
        platform::accessibility_action(locator,&action,text.as_deref(),number)
    }).await.map_err(|e|e.to_string()).and_then(|r|r);
    let _=platform::show_without_focus(&window);
    if let Some(bounds)=result.as_ref().ok().and_then(|r|r.bounds).or_else(platform::foreground_bounds){
        visual_target(&app,bounds,&label,if result.is_ok(){"complete"}else{"error"});
    }
    result
}

#[cfg(windows)]
#[tauri::command]
pub fn accessibility_watch(app:AppHandle,enabled:bool)->Result<String,String>{
    if enabled{platform::start_accessibility_watch(app)}
    else{platform::stop_accessibility_watch()}
}

#[cfg(windows)]
#[tauri::command]
pub fn accessibility_watch_status()->bool{platform::accessibility_watch_active()}

#[cfg(windows)]
fn visual_target(app: &AppHandle, bounds: platform::UiBounds, label: &str, phase: &str) {
    use tauri::{PhysicalPosition, PhysicalSize};
    if let Some(window) = app.get_webview_window("computer-visual") {
        let _ = window.set_ignore_cursor_events(true);
        let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
        let _ = window.set_size(PhysicalSize::new(bounds.width as u32, bounds.height as u32));
        let _ = window.show();
        let payload = serde_json::json!({"label": label, "phase": phase});
        let _ = app.emit_to("computer-visual", "computer-visual-activity", payload.clone());
        let _ = app.emit_to("main", "computer-activity", payload);
    }
}

#[cfg(windows)]
#[tauri::command]
pub fn show_computer_visual(app: AppHandle, label: String, phase: String) {
    if let Some(bounds) = platform::foreground_bounds() {
        visual_target(&app, bounds, &label.chars().take(90).collect::<String>(),
            if phase == "complete" { "complete" } else if phase == "error" { "error" } else { "action" });
    }
}

#[cfg(windows)]
#[tauri::command]
pub fn hide_computer_visual(app: AppHandle) {
    if let Some(window) = app.get_webview_window("computer-visual") {
        let _ = window.hide();
    }
}


/// Inspect the foreground app after hiding Settings. No screenshot or storage.
#[cfg(windows)]
#[cfg(windows)]
#[tauri::command]
pub async fn inspect_accessible_elements(app: AppHandle) -> Result<Vec<platform::AccessibleElement>, String> {
    let window = app.get_webview_window("main").ok_or("Settings window missing.")?;
    window.hide().map_err(|e| e.to_string())?;
    let result = tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_millis(180));
        platform::list_accessible_elements()
    }).await.map_err(|e| e.to_string()).and_then(|v| v);
    let _ = platform::show_without_focus(&window);
    result
}

#[cfg(windows)]
#[tauri::command]
pub async fn uia_control_action(app: AppHandle, action: String, expected_window: String, expected_name: String, value: Option<String>) -> Result<String, String> {
    let window = app.get_webview_window("main").ok_or("Settings window missing.")?;
    window.hide().map_err(|e| e.to_string())?;
    let action_label = format!("{} · {}", action, expected_name);
    // The target is first outlined at window level, before changing its UI.
    // The exact element bounds replace this highlight after the operation.
    let before_bounds = tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_millis(180));
        platform::foreground_bounds()
    }).await.ok().flatten();
    if let Some(bounds) = before_bounds {
        visual_target(&app, bounds, &action_label, "action");
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        platform::control_action(&action, &expected_window, &expected_name, value.as_deref())
    }).await.map_err(|e| e.to_string()).and_then(|v| v);
    // Restore Settings without stealing focus from the app being controlled.
    let _ = platform::show_without_focus(&window);
    let bounds = result.as_ref().ok().and_then(|completed| completed.bounds)
        .or_else(platform::foreground_bounds);
    if let Some(bounds) = bounds {
        visual_target(&app, bounds,
            if result.is_ok() { action_label.as_str() } else { "UIA action failed" },
            if result.is_ok() { "complete" } else { "error" });
    }
    result.map(|completed| completed.message)
}

#[cfg(windows)]
#[tauri::command]
pub async fn activate_accessible_window(title: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || platform::activate_window(&title))
        .await.map_err(|e| e.to_string())?
}

#[cfg(windows)]
#[tauri::command]
pub async fn list_installed_apps() -> Result<Vec<platform::InstalledApp>, String> {
    tauri::async_runtime::spawn_blocking(platform::list_installed_apps)
        .await.map_err(|e| e.to_string())
}

#[cfg(windows)]
#[tauri::command]
pub async fn focus_accessible_control(app: AppHandle, expected_name: String) -> Result<String, String> {
    let window = app.get_webview_window("main").ok_or("Settings window missing.")?;
    window.hide().map_err(|e| e.to_string())?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(std::time::Duration::from_millis(180));
        platform::focus_accessible_control(&expected_name)
    }).await.map_err(|e| e.to_string()).and_then(|v| v);
    let _ = window.show();
    result
}

#[cfg(windows)]
#[tauri::command]
pub async fn invoke_accessible_control(app: AppHandle, expected_name: String) -> Result<String, String> {
    let window = app.get_webview_window("main").ok_or("Settings window missing.")?;
    window.hide().map_err(|e| e.to_string())?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(std::time::Duration::from_millis(180));
        platform::invoke_focused_control(&expected_name)
    }).await.map_err(|e| e.to_string()).and_then(|v| v);
    let _ = window.show();
    result
}

#[cfg(windows)]
#[tauri::command]
pub async fn inspect_accessibility(app: AppHandle) -> Result<platform::AccessibilityContext, String> {
    let window = app.get_webview_window("main").ok_or("Settings window missing.")?;
    window.hide().map_err(|e| e.to_string())?;
    let result = tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_millis(180));
        platform::inspect_accessibility()
    }).await.map_err(|e| e.to_string()).and_then(|v| v);
    let _ = window.show();
    if let Ok(ref inspected) = result {
        if let Some(bounds) = inspected.bounds {
            visual_target(&app, bounds, inspected.focused_name.as_deref().unwrap_or("Accessible control"), "inspect");
        }
    }
    result
}

/// Paste a camera bitmap into the user-selected foreground application input.
#[cfg(windows)]
#[tauri::command]
pub async fn paste_camera_photo_image(app: AppHandle, bitmap_base64: String, expected_window: String) -> Result<String, String> {
    let window = app.get_webview_window("main").ok_or("Settings window missing.")?;
    window.hide().map_err(|e| e.to_string())?;
    let before_bounds = tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_millis(200));
        platform::foreground_bounds()
    }).await.ok().flatten();
    if let Some(bounds) = before_bounds {
        visual_target(&app, bounds, "Pasting camera photo", "action");
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        platform::insert_camera_image(&bitmap_base64, &expected_window)
    }).await.map_err(|e| e.to_string()).and_then(|value| value);
    let _ = platform::show_without_focus(&window);
    if let Some(bounds) = before_bounds {
        visual_target(&app, bounds,
            if result.is_ok() { "Camera photo paste requested" } else { "Camera photo paste failed" },
            if result.is_ok() { "complete" } else { "error" });
    }
    result
}

/// Pastes into the window focused at call time. Blocks a worker thread for the paste settle delay.
/// Returns the receiving application when the paste is sent, or null when it cannot be named.
#[tauri::command]
pub async fn insert_text(text: String) -> Result<Option<platform::TargetApp>, String> {
    tauri::async_runtime::spawn_blocking(move || platform::insert_text(&text))
        .await
        .map_err(|e| e.to_string())?
}

/// Replaces only a verified provisional span in a supported Windows edit control.
#[tauri::command]
pub async fn live_dictation_text(phase: String, text: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || platform::live_dictation_text(&phase, &text))
        .await
        .map_err(|error| error.to_string())
}

/// Hides Settings so Windows restores the previously focused app before pasting the handoff.
#[tauri::command]
pub async fn insert_handoff_text(app: AppHandle, text: String) -> Result<Option<platform::TargetApp>, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("The Settings window is missing.")?;
    window.hide().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(std::time::Duration::from_millis(150));
        platform::insert_text(&text)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Windows toast for a handoff that just arrived. Clicking it emits `handoff-alert-click`.
#[tauri::command]
pub async fn show_handoff_alert(
    app: AppHandle,
    id: String,
    title: String,
    body: String,
) -> Result<(), String> {
    platform::show_handoff_alert(&app, &id, &title, &body)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedSelection {
    pub text: String,
    pub source_app: Option<String>,
}

/// Hides Settings so the previous app is focused, copies its selection, then optionally shows Settings again.
#[tauri::command]
pub async fn capture_selection(
    app: AppHandle,
    restore_settings: Option<bool>,
) -> Result<CapturedSelection, String> {
    let restore = restore_settings.unwrap_or(true);
    let window = app
        .get_webview_window("main")
        .ok_or("The Settings window is missing.")?;
    window.hide().map_err(|e| e.to_string())?;
    let result = tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_millis(150));
        platform::capture_selection()
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|inner| inner);
    if restore {
        // `unminimize` is desktop-only; Android builds reject it at compile time.
        #[cfg(desktop)]
        {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        #[cfg(not(desktop))]
        {
            let _ = window.show();
        }
    }
    result.map(|(text, source_app)| CapturedSelection { text, source_app })
}

/// Hides Settings, captures the window that becomes active, then shows Settings again.
/// Falls back to the primary screen. The pixels are returned in memory only.
#[tauri::command]
pub async fn capture_snapshot(app: AppHandle) -> Result<platform::SnapshotFrame, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("The Settings window is missing.")?;
    window.hide().map_err(|e| e.to_string())?;
    let result = tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_millis(150));
        platform::capture_snapshot()
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|inner| inner);
    #[cfg(desktop)]
    {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    #[cfg(not(desktop))]
    {
        let _ = window.show();
    }
    result
}

/// Hides Settings, then reads window titles only. Does not click or type.
#[tauri::command]
pub async fn describe_windows(app: AppHandle) -> Result<platform::WindowReport, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("The Settings window is missing.")?;
    window.hide().map_err(|error| error.to_string())?;
    let result = tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_millis(150));
        platform::describe_windows()
    })
    .await
    .map_err(|error| error.to_string())
    .and_then(|inner| inner);
    #[cfg(desktop)]
    {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    #[cfg(not(desktop))]
    {
        let _ = window.show();
    }
    result
}

#[tauri::command]
pub fn set_push_to_talk_shortcut(shortcut: String) -> Result<(), String> {
    platform::set_push_to_talk_shortcut(&shortcut)
}

#[tauri::command]
pub fn set_hotkeys(
    dictate: Vec<String>,
    dictate_long_press: Vec<platform::LongPressHotkey>,
    voice_note: Vec<String>,
    handoff: Vec<String>,
    selection: Vec<String>,
    assistant: Vec<String>,
) -> Result<(), String> {
    platform::set_hotkeys(&dictate, &dictate_long_press, &voice_note, &handoff, &selection, &assistant)
}

/// Lets the Settings window see the next chord instead of starting dictation with it.
#[tauri::command]
pub fn set_hotkey_capture(active: bool) -> Result<(), String> {
    platform::set_hotkey_capture(active)
}

#[tauri::command]
pub fn get_launch_at_login() -> Result<bool, String> {
    platform::launch_at_login()
}

#[tauri::command]
pub fn set_launch_at_login(enabled: bool) -> Result<(), String> {
    platform::set_launch_at_login(enabled)
}

/// While active, Escape cancels the utterance instead of reaching the focused app.
#[tauri::command]
pub fn set_dictation_active(active: bool) {
    platform::set_dictation_active(active);
}

/// Shows or hides the always-on-top control and pushes its snapshot to the overlay window.
#[tauri::command]
pub fn sync_overlay(app: AppHandle, snapshot: serde_json::Value) -> Result<(), String> {
    let visible = snapshot
        .get("visible")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let window = app
        .get_webview_window(INDICATOR_WINDOW)
        .ok_or("The overlay window is missing.")?;
    app.emit_to(INDICATOR_WINDOW, "overlay-snapshot", snapshot)
        .map_err(|e| e.to_string())?;
    if visible {
        platform::show_without_focus(&window)
    } else {
        platform::hide_window(&window)
    }
}

/// Grows the overlay beside the buttons so a tooltip fits, then pins it.
/// Returns `"left"` or `"right"`. Pass `side` after the UI has aligned to that edge
/// so the button stack does not jump when the window expands.
#[tauri::command]
pub fn resize_overlay(
    app: AppHandle,
    expanded: bool,
    side: Option<String>,
) -> Result<&'static str, String> {
    let window = app
        .get_webview_window(INDICATOR_WINDOW)
        .ok_or("The overlay window is missing.")?;
    let chosen = platform::set_overlay_tip_expanded(&window, expanded, side.as_deref())?;
    platform::pin_overlay(&window)?;
    Ok(chosen)
}

/// Which side has room for a tip, without resizing yet.
#[tauri::command]
pub fn peek_overlay_tip_side(app: AppHandle) -> Result<&'static str, String> {
    let window = app
        .get_webview_window(INDICATOR_WINDOW)
        .ok_or("The overlay window is missing.")?;
    platform::peek_overlay_tip_side(&window)
}

/// Grows the overlay so Confirm and Cancel fit under the Assistant button, then pins it.
#[tauri::command]
pub fn resize_overlay_confirm(app: AppHandle, expanded: bool) -> Result<(), String> {
    platform::set_overlay_confirm_expanded(expanded);
    let window = app
        .get_webview_window(INDICATOR_WINDOW)
        .ok_or("The overlay window is missing.")?;
    platform::pin_overlay(&window)
}

/// Restores a saved bottom-right anchor (physical pixels), or clears it for the default corner.
#[tauri::command]
pub fn set_overlay_anchor(app: AppHandle, x: Option<i32>, y: Option<i32>) -> Result<(), String> {
    let anchor = match (x, y) {
        (Some(right), Some(bottom)) => Some((right, bottom)),
        _ => None,
    };
    platform::set_overlay_anchor(anchor);
    let window = app
        .get_webview_window(INDICATOR_WINDOW)
        .ok_or("The overlay window is missing.")?;
    platform::pin_overlay(&window)
}

/// Stops `pin_overlay` from fighting a user drag (OS or manual).
#[tauri::command]
pub fn begin_overlay_drag() {
    platform::begin_overlay_drag();
}

/// Moves the overlay to a physical top-left while the user is dragging it.
#[tauri::command]
pub fn drag_overlay(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    let window = app
        .get_webview_window(INDICATOR_WINDOW)
        .ok_or("The overlay window is missing.")?;
    platform::drag_overlay(&window, x, y)
}

/// Saves the current bottom-right as the custom anchor and ends the drag.
#[tauri::command]
pub fn commit_overlay_position(app: AppHandle) -> Result<(i32, i32), String> {
    let window = app
        .get_webview_window(INDICATOR_WINDOW)
        .ok_or("The overlay window is missing.")?;
    platform::commit_overlay_position(&window)
}

#[tauri::command]
pub async fn open_allowlisted_app(id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || platform::open_allowlisted_app(&id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn press_allowlisted_shortcut(app: AppHandle, id: String, restore: Option<bool>) -> Result<String, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("The Settings window is missing.")?;
    window.hide().map_err(|error| error.to_string())?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(std::time::Duration::from_millis(150));
        platform::press_allowlisted_shortcut(&id)
    })
    .await
    .map_err(|error| error.to_string())
    .and_then(|inner| inner);
    if restore.unwrap_or(true) {
        #[cfg(desktop)]
        {
            let _ = window.show();
        }
    }
    result
}

/// Hides Settings and captures the screen underneath. The window stays hidden until `computer_restore`.
#[tauri::command]
pub async fn computer_capture(app: AppHandle) -> Result<platform::SnapshotFrame, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("The Settings window is missing.")?;
    window.hide().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_millis(150));
        platform::capture_snapshot()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn computer_click(x: i32, y: i32, times: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || platform::click_normalized(x, y, times))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn computer_restore(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("The Settings window is missing.")?;
    #[cfg(desktop)]
    {
        let _ = window.unminimize();
        window.show().map_err(|error| error.to_string())?;
    }
    #[cfg(not(desktop))]
    let _ = window;
    Ok(())
}

#[tauri::command]
pub fn show_settings(app: AppHandle) {
    #[cfg(desktop)]
    crate::tray::show_main(&app);
    #[cfg(not(desktop))]
    let _ = app;
}

#[cfg(all(test, windows))]
mod overlay_feedback_tests {
    use super::{popup_corner_position, OverlayFeedbackState};

    #[test]
    fn corner_does_not_depend_on_indicator_position_or_taskbar_bounds() {
        assert_eq!(popup_corner_position(0, 0, 1920, 1040, 420, 140, 0), (1418, 884));
        assert_eq!(popup_corner_position(-1920, 20, 1920, 980, 420, 140, 0), (-502, 844));
        assert_eq!(popup_corner_position(0, 0, 1920, 1040, 420, 140, 272), (1418, 612));
    }

    #[test]
    fn tool_action_and_notification_remain_independent() {
        let mut state = OverlayFeedbackState::default();
        state.hint = Some("Start Assistant".into());
        assert_eq!(state.current().message.as_deref(), Some("Start Assistant"));
        state.notice = Some("File system is unavailable".into());
        assert_eq!(state.current().kind, Some("notice"));
        state.notice = None;
        assert_eq!(state.current().kind, Some("hint"));
    }

    #[test]
    fn popup_window_dimensions_are_fixed_and_not_based_on_message_length() {
        assert_eq!(super::POPUP_WIDTH, 440.0);
        assert_eq!(super::POPUP_HEIGHT, 300.0);
        assert_eq!(popup_corner_position(0, 0, 1920, 1040, 440, 300, 0), (1398, 724));
    }
}
