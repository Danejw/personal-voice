//! IPC surface for the shared frontend's `PlatformAdapter`.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::platform;

pub const INDICATOR_WINDOW: &str = "indicator";

/// Pastes into the window focused at call time. Blocks a worker thread for the paste settle delay.
/// Returns the receiving application when the paste is sent, or null when it cannot be named.
#[tauri::command]
pub async fn insert_text(text: String) -> Result<Option<platform::TargetApp>, String> {
    tauri::async_runtime::spawn_blocking(move || platform::insert_text(&text))
        .await
        .map_err(|e| e.to_string())?
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

#[tauri::command]
pub fn set_push_to_talk_shortcut(shortcut: String) -> Result<(), String> {
    platform::set_push_to_talk_shortcut(&shortcut)
}

#[tauri::command]
pub fn set_hotkeys(
    dictate: Vec<String>,
    voice_note: Vec<String>,
    handoff: Vec<String>,
    selection: Vec<String>,
) -> Result<(), String> {
    platform::set_hotkeys(&dictate, &voice_note, &handoff, &selection)
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

/// Grows the overlay leftward so a tooltip can sit beside the buttons, then pins it.
#[tauri::command]
pub fn resize_overlay(app: AppHandle, expanded: bool) -> Result<(), String> {
    platform::set_overlay_tip_expanded(expanded);
    let window = app
        .get_webview_window(INDICATOR_WINDOW)
        .ok_or("The overlay window is missing.")?;
    platform::pin_overlay(&window)
}

#[tauri::command]
pub fn show_settings(app: AppHandle) {
    #[cfg(desktop)]
    crate::tray::show_main(&app);
    #[cfg(not(desktop))]
    let _ = app;
}
