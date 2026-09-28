mod hook;
mod insert;
mod push_to_talk;

use tauri::{AppHandle, Emitter, WebviewWindow};
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE,
    SW_SHOWNOACTIVATE,
};

pub use hook::{set_active as set_dictation_active, set_paused};
pub use insert::insert_text;

use push_to_talk::{PttEvent, Shortcut};

/// Emits `push-to-talk` (`"press" | "release" | "cancel"`) to the main window.
pub fn start_push_to_talk(app: AppHandle) -> Result<(), String> {
    hook::start(move |event| {
        let kind = match event {
            PttEvent::Press => "press",
            PttEvent::Release => "release",
            PttEvent::Cancel => "cancel",
        };
        let _ = app.emit_to("main", "push-to-talk", kind);
    })
}

pub fn set_push_to_talk_shortcut(shortcut: &str) -> Result<(), String> {
    hook::set_shortcut(Shortcut::parse(shortcut)?);
    Ok(())
}

/// Tauri's `show()` activates the window, which would steal focus from the dictation target.
pub fn show_without_focus(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
        .map_err(|e| e.to_string())
    }
}

/// Pairs with `show_without_focus`: tao never learned the window was shown, so its `hide()` is a no-op.
pub fn hide_window(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    unsafe {
        let _ = ShowWindow(hwnd, SW_HIDE);
    }
    Ok(())
}
