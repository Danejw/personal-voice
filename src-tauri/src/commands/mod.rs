//! IPC surface for the shared frontend's `PlatformAdapter`.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::platform;

pub const INDICATOR_WINDOW: &str = "indicator";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum IndicatorState {
    Listening,
    Finalizing,
    Error { message: String },
}

/// Pastes into the window focused at call time. Blocks a worker thread for the paste settle delay.
#[tauri::command]
pub async fn insert_text(text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || platform::insert_text(&text))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn set_push_to_talk_shortcut(shortcut: String) -> Result<(), String> {
    platform::set_push_to_talk_shortcut(&shortcut)
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

#[tauri::command]
pub fn show_indicator(app: AppHandle, state: IndicatorState) -> Result<(), String> {
    let window = app
        .get_webview_window(INDICATOR_WINDOW)
        .ok_or("The indicator window is missing.")?;
    app.emit_to(INDICATOR_WINDOW, "indicator-state", state)
        .map_err(|e| e.to_string())?;
    platform::show_without_focus(&window)
}

#[tauri::command]
pub fn hide_indicator(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(INDICATOR_WINDOW)
        .ok_or("The indicator window is missing.")?;
    platform::hide_window(&window)
}
