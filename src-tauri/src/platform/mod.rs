//! OS-specific behavior. Windows is implemented in Rust here. Android is a Kotlin plugin
//! (`android.rs`) that the frontend calls directly, so the Windows commands below report
//! "unsupported" on other targets.

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
    ) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
    pub fn set_hotkey_capture(_active: bool) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
    pub fn set_dictation_active(_active: bool) {}
    #[cfg_attr(mobile, allow(dead_code))]
    pub fn set_paused(_paused: bool) {}
    pub fn insert_text(_text: &str) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
    pub fn capture_selection() -> Result<(String, Option<String>), String> {
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
    pub fn show_without_focus(window: &WebviewWindow) -> Result<(), String> {
        window.show().map_err(|e| e.to_string())
    }
    pub fn hide_window(window: &WebviewWindow) -> Result<(), String> {
        window.hide().map_err(|e| e.to_string())
    }
}
#[cfg(not(windows))]
pub use unsupported::*;
