//! OS-specific behavior. Windows is implemented in Rust here. Android is a Kotlin plugin
//! (`android.rs`) that the frontend calls directly, so the Windows commands below report
//! "unsupported" on other targets.

use serde::Serialize;

/// The application that received a paste. `id` is a file or package name, never a window title.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TargetApp {
    pub id: String,
    pub label: String,
}

/// One in-memory screenshot. `rgba` is tightly packed base64. Nothing is stored on disk.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotFrame {
    pub source: &'static str,
    pub source_app: Option<String>,
    pub width: u32,
    pub height: u32,
    pub rgba: String,
}

/// Window titles only. No pixels and no input.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowReport {
    pub active: Option<String>,
    pub windows: Vec<String>,
}

#[cfg(target_os = "android")]
pub mod android;

/// Passed by the launch-at-startup entry, so a sign-in launch starts in the tray.
#[cfg_attr(mobile, allow(dead_code))]
pub const AUTOSTART_ARG: &str = "--autostart";

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use self::windows::*;

#[cfg(not(windows))]
mod unsupported {
    use tauri::{AppHandle, WebviewWindow};

    const UNSUPPORTED: &str = "Not supported on this platform yet.";

    #[cfg_attr(mobile, allow(dead_code))]
    pub fn start_push_to_talk(_app: AppHandle) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
    pub fn set_push_to_talk_shortcut(_shortcut: &str) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
    pub fn set_hotkeys(
        _dictate: &[String],
        _voice_note: &[String],
        _handoff: &[String],
        _selection: &[String],
        _assistant: &[String],
    ) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
    pub fn set_hotkey_capture(_active: bool) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
    pub fn set_dictation_active(_active: bool) {}
    #[cfg_attr(mobile, allow(dead_code))]
    pub fn set_paused(_paused: bool) {}
    pub fn live_dictation_text(_phase: &str, _text: &str) -> bool { false }
    pub fn insert_text(_text: &str) -> Result<Option<super::TargetApp>, String> {
        Err(UNSUPPORTED.into())
    }
    pub fn capture_selection() -> Result<(String, Option<String>), String> {
        Err(UNSUPPORTED.into())
    }
    pub fn capture_snapshot() -> Result<super::SnapshotFrame, String> {
        Err(UNSUPPORTED.into())
    }
    pub fn describe_windows() -> Result<super::WindowReport, String> {
        Err(UNSUPPORTED.into())
    }
    pub fn open_allowlisted_app(_id: &str) -> Result<String, String> {
        Err(UNSUPPORTED.into())
    }
    pub fn press_allowlisted_shortcut(_id: &str) -> Result<String, String> {
        Err(UNSUPPORTED.into())
    }
    pub fn click_normalized(_x: i32, _y: i32, _times: u32) -> Result<String, String> {
        Err(UNSUPPORTED.into())
    }
    pub fn finish_pending_restore() {}
    pub fn launch_at_login() -> Result<bool, String> {
        Err(UNSUPPORTED.into())
    }
    pub fn set_launch_at_login(_enabled: bool) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
    pub fn prepare_overlay(_window: &WebviewWindow) -> Result<(), String> {
        Ok(())
    }
    pub fn pin_overlay(_window: &WebviewWindow) -> Result<(), String> {
        Ok(())
    }
    pub fn set_overlay_tip_expanded(
        _window: &WebviewWindow,
        _expanded: bool,
        _side: Option<&str>,
    ) -> Result<&'static str, String> {
        Ok("left")
    }
    pub fn peek_overlay_tip_side(_window: &WebviewWindow) -> Result<&'static str, String> {
        Ok("left")
    }
    pub fn set_overlay_confirm_expanded(_expanded: bool) {}
    pub fn set_overlay_anchor(_anchor: Option<(i32, i32)>) {}
    pub fn begin_overlay_drag() {}
    pub fn drag_overlay(_window: &WebviewWindow, _x: i32, _y: i32) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
    pub fn commit_overlay_position(_window: &WebviewWindow) -> Result<(i32, i32), String> {
        Err(UNSUPPORTED.into())
    }
    pub fn show_without_focus(window: &WebviewWindow) -> Result<(), String> {
        window.show().map_err(|e| e.to_string())
    }
    pub fn hide_window(window: &WebviewWindow) -> Result<(), String> {
        window.hide().map_err(|e| e.to_string())
    }
    pub fn show_handoff_alert(
        _app: &AppHandle,
        _id: &str,
        _title: &str,
        _body: &str,
    ) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
    pub fn notify_handoff_click(_app: &AppHandle, _id: &str) {}
}
#[cfg(not(windows))]
pub use unsupported::*;
