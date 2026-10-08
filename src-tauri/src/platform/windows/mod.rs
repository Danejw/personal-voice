mod accessibility;
mod accessibility_plus;
mod accessibility_events;
mod autostart;
mod computer;
mod handoff_alert;
mod hook;
mod insert;
mod installed_apps;
mod live_text;
mod push_to_talk;
mod snapshot;
mod windows_info;

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, WebviewWindow};
use windows::Win32::Foundation::RECT;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, GetWindowRect, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE,
    HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_SHOWNOACTIVATE,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

pub use installed_apps::{list_installed_apps, InstalledApp};
pub use accessibility_plus::{inspect_tree as inspect_accessibility_tree, action as accessibility_action, Locator as AccessibilityLocator, ActionResult as AccessibilityActionResult, TreeReport as AccessibilityTreeReport};
pub use accessibility_events::{start as start_accessibility_watch, stop as stop_accessibility_watch, active as accessibility_watch_active};
pub use accessibility::{inspect_accessibility, invoke_focused_control, focus_accessible_control, control_action, list_accessible_elements, AccessibleElement, foreground_bounds, UiBounds, AccessibilityContext};
pub use autostart::{launch_at_login, set_launch_at_login};
pub use computer::{click_normalized, open_allowlisted_app, press_allowlisted_shortcut};
pub use handoff_alert::{notify_handoff_click, show_handoff_alert};
pub use hook::{set_active as set_dictation_active, set_paused};
pub use insert::{capture_selection, finish_pending_restore, insert_text, insert_camera_image};
pub use live_text::live_dictation_text;
pub use snapshot::capture_snapshot;
pub use windows_info::{describe_windows, activate_window};

use push_to_talk::{DestOverride, LongPressShortcut, PttEvent, Shortcut};

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
                Some(DestOverride::Handoff) => Some("remote-dictation"),
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
        PttEvent::ToggleAssistant => PushToTalkPayload {
            event: "toggle-assistant",
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
    dictate_long_press: &[crate::platform::LongPressHotkey],
    voice_note: &[String],
    handoff: &[String],
    selection: &[String],
    assistant: &[String],
) -> Result<(), String> {
    fn parse_list(values: &[String]) -> Result<Vec<Shortcut>, String> {
        values.iter().map(|value| Shortcut::parse(value)).collect()
    }
    let long_press = dictate_long_press
        .iter()
        .map(|binding| LongPressShortcut::new(Shortcut::parse(&binding.shortcut)?, binding.hold_ms))
        .collect::<Result<Vec<_>, String>>()?;
    hook::set_hotkeys(
        parse_list(dictate)?,
        long_press,
        parse_list(voice_note)?,
        parse_list(handoff)?,
        parse_list(selection)?,
        parse_list(assistant)?,
    )
}

pub fn set_hotkey_capture(active: bool) -> Result<(), String> {
    hook::set_capturing(active)
}

/// Device-independent size of the button stack. Physical pixels are derived from the monitor.
const OVERLAY_W: f64 = 44.0;
const OVERLAY_H: f64 = 194.0;
/// Extra width beside the buttons while a tooltip is open.
const OVERLAY_TIP_EXTRA: f64 = 220.0;
/// Extra height for Confirm and Cancel while an Assistant action is waiting.
const OVERLAY_CONFIRM_EXTRA: f64 = 76.0;
/// Inset from the work-area corner, in device-independent pixels.
const OVERLAY_MARGIN_DIP: f64 = 16.0;

static PINNING: AtomicBool = AtomicBool::new(false);
static DRAGGING: AtomicBool = AtomicBool::new(false);
static TIP_EXPANDED: AtomicBool = AtomicBool::new(false);
static CONFIRM_EXPANDED: AtomicBool = AtomicBool::new(false);
/// 0 = tip grows left of the buttons, 1 = tip grows right.
static TIP_SIDE_RIGHT: AtomicBool = AtomicBool::new(false);
/// Physical bottom-right of the overlay when the user has moved it. `None` = default corner.
static OVERLAY_ANCHOR: Mutex<Option<(i32, i32)>> = Mutex::new(None);

/// Which side of the button stack has room for a tooltip.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverlayTipSide {
    Left,
    Right,
}

impl OverlayTipSide {
    fn as_str(self) -> &'static str {
        match self {
            OverlayTipSide::Left => "left",
            OverlayTipSide::Right => "right",
        }
    }

    fn from_right_flag(right: bool) -> Self {
        if right {
            OverlayTipSide::Right
        } else {
            OverlayTipSide::Left
        }
    }
}

/// Physical top-left and size for the overlay window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OverlayPlace {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Places the overlay from work-area bounds. `anchor` is the physical bottom-right of the
/// collapsed button stack when set. Tip expansion grows left or right from that stack and
/// must not move the stack — clamp never shifts the buttons for tip size changes.
pub fn overlay_place(
    area_x: i32,
    area_y: i32,
    area_w: u32,
    area_h: u32,
    scale: f64,
    tip_expanded: bool,
    tip_side: OverlayTipSide,
    confirm_expanded: bool,
    anchor: Option<(i32, i32)>,
) -> OverlayPlace {
    let scale = scale.max(1.0);
    let collapsed_w = (OVERLAY_W * scale).round() as i32;
    let logical_w = if tip_expanded {
        OVERLAY_W + OVERLAY_TIP_EXTRA
    } else {
        OVERLAY_W
    };
    let width = (logical_w * scale).round() as i32;
    let logical_h = if confirm_expanded {
        OVERLAY_H + OVERLAY_CONFIRM_EXTRA
    } else {
        OVERLAY_H
    };
    let height = (logical_h * scale).round() as i32;
    let margin = (OVERLAY_MARGIN_DIP * scale).round() as i32;
    let area_right = area_x + area_w as i32;
    let max_y = area_y + area_h as i32 - height;
    let (raw_x, raw_y) = match anchor {
        Some((right, bottom)) => {
            let stack_left = right - collapsed_w;
            let x = match (tip_expanded, tip_side) {
                // Keep the button stack fixed; tip fills space to the left.
                (true, OverlayTipSide::Left) => right - width,
                // Keep the button stack fixed; tip fills space to the right.
                (true, OverlayTipSide::Right) => stack_left,
                _ => stack_left,
            };
            (x, bottom - height)
        }
        None => {
            let max_x = area_right - width;
            (max_x - margin, max_y - margin)
        }
    };
    // Tip expansion must not shove the button stack. Only clamp Y and the default (no-anchor) X.
    let x = if anchor.is_some() && tip_expanded {
        raw_x
    } else {
        let max_x = area_right - width;
        raw_x.clamp(area_x, max_x.max(area_x))
    };
    OverlayPlace {
        x,
        y: raw_y.clamp(area_y, max_y.max(area_y)),
        width,
        height,
    }
}

/// Monitor that currently contains the overlay (falls back to primary).
fn overlay_monitor(window: &WebviewWindow) -> Result<Option<tauri::Monitor>, String> {
    if let Some(monitor) = window.current_monitor().map_err(|e| e.to_string())? {
        return Ok(Some(monitor));
    }
    window.primary_monitor().map_err(|e| e.to_string())
}

/// Pick the tip side that fits the tip width on the window's current monitor.
pub fn choose_overlay_tip_side(window: &WebviewWindow) -> Result<OverlayTipSide, String> {
    let Some(monitor) = overlay_monitor(window)? else {
        return Ok(OverlayTipSide::Left);
    };
    let area = monitor.work_area();
    let scale = monitor.scale_factor().max(1.0);
    let tip_px = (OVERLAY_TIP_EXTRA * scale).round() as i32;
    let collapsed_w = (OVERLAY_W * scale).round() as i32;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.map_err(|e| e.to_string())?;
    // Prefer the side of the button stack. While tip-expanded, the stack sits on tip_side's opposite edge.
    let tip_right = TIP_SIDE_RIGHT.load(Ordering::SeqCst);
    let tip_on = TIP_EXPANDED.load(Ordering::SeqCst);
    let stack_left = if tip_on && !tip_right {
        rect.right - collapsed_w
    } else {
        rect.left
    };
    let stack_right = if tip_on && tip_right {
        rect.left + collapsed_w
    } else {
        rect.right
    };
    let space_left = stack_left - area.position.x;
    let space_right = area.position.x + area.size.width as i32 - stack_right;
    let left_fits = space_left >= tip_px;
    let right_fits = space_right >= tip_px;
    // Never prefer a side that clips the tip when the other side fits.
    Ok(match (left_fits, right_fits) {
        (true, false) => OverlayTipSide::Left,
        (false, true) => OverlayTipSide::Right,
        (true, true) if space_left >= space_right => OverlayTipSide::Left,
        (true, true) => OverlayTipSide::Right,
        _ if space_right > space_left => OverlayTipSide::Right,
        _ => OverlayTipSide::Left,
    })
}

/// Widen the overlay for a tooltip. Always picks a side that fits on the current monitor.
pub fn set_overlay_tip_expanded(
    window: &WebviewWindow,
    expanded: bool,
    _side: Option<&str>,
) -> Result<&'static str, String> {
    if expanded {
        let chosen = choose_overlay_tip_side(window)?;
        TIP_SIDE_RIGHT.store(matches!(chosen, OverlayTipSide::Right), Ordering::SeqCst);
        TIP_EXPANDED.store(true, Ordering::SeqCst);
        Ok(chosen.as_str())
    } else {
        TIP_EXPANDED.store(false, Ordering::SeqCst);
        Ok(OverlayTipSide::from_right_flag(TIP_SIDE_RIGHT.load(Ordering::SeqCst)).as_str())
    }
}

/// Peek which tip side would be used without resizing.
pub fn peek_overlay_tip_side(window: &WebviewWindow) -> Result<&'static str, String> {
    Ok(choose_overlay_tip_side(window)?.as_str())
}

/// Taller overlay while Confirm and Cancel are on the button stack.
pub fn set_overlay_confirm_expanded(expanded: bool) {
    CONFIRM_EXPANDED.store(expanded, Ordering::SeqCst);
}

/// Remembers a user-chosen bottom-right anchor (physical pixels).
pub fn set_overlay_anchor(anchor: Option<(i32, i32)>) {
    if let Ok(mut slot) = OVERLAY_ANCHOR.lock() {
        *slot = anchor;
    }
}

fn overlay_anchor() -> Option<(i32, i32)> {
    OVERLAY_ANCHOR.lock().ok().and_then(|slot| *slot)
}

/// Marks the overlay as user-dragged so `pin_overlay` does not snap it while moving.
pub fn begin_overlay_drag() {
    DRAGGING.store(true, Ordering::SeqCst);
}

/// Move the overlay to a physical top-left without changing size. Starts a drag if needed.
pub fn drag_overlay(window: &WebviewWindow, x: i32, y: i32) -> Result<(), String> {
    DRAGGING.store(true, Ordering::SeqCst);
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            x,
            y,
            0,
            0,
            SWP_NOSIZE | SWP_NOACTIVATE,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Stores the current button-stack bottom-right as the custom anchor and ends the drag.
pub fn commit_overlay_position(window: &WebviewWindow) -> Result<(i32, i32), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.map_err(|e| e.to_string())?;
    let scale = overlay_monitor(window)?
        .map(|monitor| monitor.scale_factor().max(1.0))
        .unwrap_or(1.0);
    let collapsed_w = (OVERLAY_W * scale).round() as i32;
    // Tip-right grows past the buttons; persist the stack edge, not the tip edge.
    let right = if TIP_EXPANDED.load(Ordering::SeqCst) && TIP_SIDE_RIGHT.load(Ordering::SeqCst) {
        rect.left + collapsed_w
    } else {
        rect.right
    };
    let anchor = (right, rect.bottom);
    set_overlay_anchor(Some(anchor));
    DRAGGING.store(false, Ordering::SeqCst);
    Ok(anchor)
}

/// Bottom-right of the primary work area by default, or the saved custom anchor.
/// Size and position are applied together so the window cannot open centered and then jump off-screen.
pub fn pin_overlay(window: &WebviewWindow) -> Result<(), String> {
    if DRAGGING.load(Ordering::SeqCst) {
        return Ok(());
    }
    if PINNING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let result = pin_overlay_inner(window);
    PINNING.store(false, Ordering::SeqCst);
    result
}

fn pin_overlay_inner(window: &WebviewWindow) -> Result<(), String> {
    let Some(monitor) = overlay_monitor(window)? else {
        return Ok(());
    };
    let area = monitor.work_area();
    let place = overlay_place(
        area.position.x,
        area.position.y,
        area.size.width,
        area.size.height,
        monitor.scale_factor(),
        TIP_EXPANDED.load(Ordering::SeqCst),
        OverlayTipSide::from_right_flag(TIP_SIDE_RIGHT.load(Ordering::SeqCst)),
        CONFIRM_EXPANDED.load(Ordering::SeqCst),
        overlay_anchor(),
    );
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let mut rect = RECT::default();
    let already_there = unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok()
        && (rect.left - place.x).abs() <= 2
        && (rect.top - place.y).abs() <= 2
        && (rect.right - rect.left - place.width).abs() <= 24
        && (rect.bottom - rect.top - place.height).abs() <= 24;
    if already_there {
        return Ok(());
    }
    // Direct placement. Tauri's setter queues the move, which is why the stack
    // appeared in the center and then slid past the right edge.
    unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            place.x,
            place.y,
            place.width,
            place.height,
            SWP_NOACTIVATE,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod overlay_place_tests {
    use super::{overlay_place, OverlayTipSide};

    #[test]
    fn defaults_to_bottom_right_with_margin() {
        let place = overlay_place(0, 0, 1920, 1040, 1.0, false, OverlayTipSide::Left, false, None);
        assert_eq!(place.width, 44);
        assert_eq!(place.height, 194);
        assert_eq!(place.x, 1920 - 44 - 16);
        assert_eq!(place.y, 1040 - 194 - 16);
    }

    #[test]
    fn honors_custom_anchor_and_grows_tip_left() {
        let collapsed = overlay_place(0, 0, 1920, 1040, 1.0, false, OverlayTipSide::Left, false, Some((1800, 900)));
        assert_eq!(collapsed.x, 1800 - 44);
        assert_eq!(collapsed.y, 900 - 194);
        let tip = overlay_place(0, 0, 1920, 1040, 1.0, true, OverlayTipSide::Left, false, Some((1800, 900)));
        assert_eq!(tip.width, 44 + 220);
        assert_eq!(tip.x, 1800 - tip.width);
        assert_eq!(tip.y, collapsed.y);
    }

    #[test]
    fn tip_expand_does_not_move_the_button_stack() {
        let collapsed = overlay_place(0, 0, 1920, 1040, 1.0, false, OverlayTipSide::Left, false, Some((200, 900)));
        let tip_left = overlay_place(0, 0, 1920, 1040, 1.0, true, OverlayTipSide::Left, false, Some((200, 900)));
        assert_eq!(tip_left.x + tip_left.width, collapsed.x + collapsed.width);
        let tip_right = overlay_place(0, 0, 1920, 1040, 1.0, true, OverlayTipSide::Right, false, Some((200, 900)));
        assert_eq!(tip_right.x, collapsed.x);
        assert_eq!(tip_right.y, collapsed.y);
    }

    #[test]
    fn grows_tip_right_from_the_button_stack() {
        let collapsed = overlay_place(0, 0, 1920, 1040, 1.0, false, OverlayTipSide::Right, false, Some((200, 900)));
        assert_eq!(collapsed.x, 200 - 44);
        let tip = overlay_place(0, 0, 1920, 1040, 1.0, true, OverlayTipSide::Right, false, Some((200, 900)));
        assert_eq!(tip.width, 44 + 220);
        assert_eq!(tip.x, collapsed.x);
        assert_eq!(tip.y, collapsed.y);
    }

    #[test]
    fn clamps_anchor_inside_the_work_area() {
        let place = overlay_place(100, 50, 800, 600, 1.0, false, OverlayTipSide::Left, false, Some((10, 10)));
        assert_eq!(place.x, 100);
        assert_eq!(place.y, 50);
    }
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
pub fn show_assistant_card(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
            .map_err(|e| e.to_string())
    }
}

pub fn hide_window(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    unsafe {
        let _ = ShowWindow(hwnd, SW_HIDE);
    }
    Ok(())
}
