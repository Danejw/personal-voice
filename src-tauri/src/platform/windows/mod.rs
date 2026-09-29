mod autostart;
mod handoff_alert;
mod hook;
mod insert;
mod push_to_talk;

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, WebviewWindow};
use windows::Win32::Foundation::RECT;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, GetWindowRect, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE,
    HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_SHOWNOACTIVATE,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

pub use autostart::{launch_at_login, set_launch_at_login};
pub use handoff_alert::{notify_handoff_click, show_handoff_alert};
pub use hook::{set_active as set_dictation_active, set_paused};
pub use insert::{capture_selection, finish_pending_restore, insert_text};

use push_to_talk::{DestOverride, PttEvent, Shortcut};

#[derive(Clone, Serialize)]
struct PushToTalkPayload {
    event: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    destination: Option<&'static str>,
}

fn push_to_talk_payload(event: PttEvent) -> PushToTalkPayload {
    match event {
        PttEvent::Press { destination } => PushToTalkPayload {
            event: "press",
            destination: match destination {
                Some(DestOverride::VoiceNote) => Some("voice-note"),
                Some(DestOverride::Handoff) => Some("send-to-device"),
                None => None,
            },
        },
        PttEvent::Release => PushToTalkPayload {
            event: "release",
            destination: None,
        },
        PttEvent::Cancel => PushToTalkPayload {
            event: "cancel",
            destination: None,
        },
        PttEvent::CaptureSelection => PushToTalkPayload {
            event: "capture-selection",
            destination: None,
        },
    }
}

/// Emits `push-to-talk` to the main window.
pub fn start_push_to_talk(app: AppHandle) -> Result<(), String> {
    hook::start(move |event| {
        let _ = app.emit_to("main", "push-to-talk", push_to_talk_payload(event));
    })
}

pub fn set_push_to_talk_shortcut(shortcut: &str) -> Result<(), String> {
    hook::set_shortcut(Shortcut::parse(shortcut)?);
    Ok(())
}

pub fn set_hotkeys(
    dictate: &[String],
    voice_note: &[String],
    handoff: &[String],
    selection: &[String],
) -> Result<(), String> {
    fn parse_list(values: &[String]) -> Result<Vec<Shortcut>, String> {
        values.iter().map(|value| Shortcut::parse(value)).collect()
    }
    hook::set_hotkeys(
        parse_list(dictate)?,
        parse_list(voice_note)?,
        parse_list(handoff)?,
        parse_list(selection)?,
    )
}

pub fn set_hotkey_capture(active: bool) -> Result<(), String> {
    hook::set_capturing(active)
}

/// Device-independent size of the button stack. Physical pixels are derived from the monitor.
const OVERLAY_W: f64 = 44.0;
const OVERLAY_H: f64 = 156.0;
/// Extra width to the left of the buttons while a tooltip is open.
const OVERLAY_TIP_EXTRA: f64 = 220.0;
/// Inset from the work-area corner, in device-independent pixels.
const OVERLAY_MARGIN_DIP: f64 = 16.0;

static PINNING: AtomicBool = AtomicBool::new(false);
static TIP_EXPANDED: AtomicBool = AtomicBool::new(false);

/// Widen the overlay for a left-side tooltip. `pin_overlay` reads this on every place.
pub fn set_overlay_tip_expanded(expanded: bool) {
    TIP_EXPANDED.store(expanded, Ordering::SeqCst);
}

/// Bottom-right of the primary display's work area, above the taskbar, at any DPI.
/// Size and position are applied together so the window cannot open centered and then jump off-screen.
pub fn pin_overlay(window: &WebviewWindow) -> Result<(), String> {
    if PINNING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let result = pin_overlay_inner(window);
    PINNING.store(false, Ordering::SeqCst);
    result
}

fn pin_overlay_inner(window: &WebviewWindow) -> Result<(), String> {
    let Some(monitor) = window.primary_monitor().map_err(|e| e.to_string())? else {
        return Ok(());
    };
    let area = monitor.work_area();
    let scale = monitor.scale_factor().max(1.0);
    let logical_w = if TIP_EXPANDED.load(Ordering::SeqCst) {
        OVERLAY_W + OVERLAY_TIP_EXTRA
    } else {
        OVERLAY_W
    };
    let width = (logical_w * scale).round() as i32;
    let height = (OVERLAY_H * scale).round() as i32;
    let margin = (OVERLAY_MARGIN_DIP * scale).round() as i32;
    let max_x = area.position.x + area.size.width as i32 - width;
    let max_y = area.position.y + area.size.height as i32 - height;
    let x = (max_x - margin).clamp(area.position.x, max_x.max(area.position.x));
    let y = (max_y - margin).clamp(area.position.y, max_y.max(area.position.y));
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let mut rect = RECT::default();
    let already_there = unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok()
        && (rect.left - x).abs() <= 2
        && (rect.top - y).abs() <= 2
        && (rect.right - rect.left - width).abs() <= 24
        && (rect.bottom - rect.top - height).abs() <= 24;
    if already_there {
        return Ok(());
    }
    // Direct placement. Tauri's setter queues the move, which is why the stack
    // appeared in the center and then slid past the right edge.
    unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            x,
            y,
            width,
            height,
            SWP_NOACTIVATE,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Clicks work; the overlay must not become the foreground window or insertion/capture miss.
pub fn prepare_overlay(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(
            hwnd,
            GWL_EXSTYLE,
            style | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize,
        );
    }
    Ok(())
}

/// Tauri's `show()` activates the window, which would steal focus from the dictation target.
pub fn show_without_focus(window: &WebviewWindow) -> Result<(), String> {
    pin_overlay(window)?;
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
