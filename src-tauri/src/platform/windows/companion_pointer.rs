//! Read-only virtual desktop geometry for opt-in Android Companion Mode.
//! No accessibility inspection, screen pixels, pointer history or input injection.
use serde::Serialize;
use windows::core::BOOL;
use windows::Win32::Foundation::{LPARAM, POINT, RECT};
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR};
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionMonitor {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionPointerSample {
    pub x: i32,
    pub y: i32,
    pub monitors: Vec<CompanionMonitor>,
}

unsafe extern "system" fn receive_monitor(
    _monitor: HMONITOR,
    _hdc: HDC,
    bounds: *mut RECT,
    context: LPARAM,
) -> BOOL {
    if bounds.is_null() || context.0 == 0 { return false.into(); }
    let monitors = unsafe { &mut *(context.0 as *mut Vec<CompanionMonitor>) };
    if monitors.len() >= 8 { return false.into(); }
    let rect = unsafe { *bounds };
    let width = rect.right.saturating_sub(rect.left);
    let height = rect.bottom.saturating_sub(rect.top);
    if width > 0 && height > 0 {
        monitors.push(CompanionMonitor { x: rect.left, y: rect.top, width, height });
    }
    true.into()
}

pub fn sample() -> Result<CompanionPointerSample, String> {
    let mut pointer = POINT::default();
    unsafe { GetCursorPos(&mut pointer) }
        .map_err(|error| format!("Cannot read cursor location: {error}"))?;
    let mut monitors = Vec::<CompanionMonitor>::new();
    unsafe {
        EnumDisplayMonitors(
            None,
            None,
            Some(receive_monitor),
            LPARAM((&mut monitors as *mut Vec<CompanionMonitor>) as isize),
        )
    }.ok().map_err(|error| format!("Cannot enumerate monitors: {error}"))?;
    if monitors.is_empty() { return Err("No connected displays were found.".to_string()); }
    Ok(CompanionPointerSample { x: pointer.x, y: pointer.y, monitors })
}

#[cfg(test)]
mod tests {
    use super::CompanionMonitor;
    #[test]
    fn negative_screen_origins_are_preserved() {
        let left = CompanionMonitor { x: -1920, y: -200, width: 1920, height: 1080 };
        assert!(left.x < 0);
        assert_eq!(left.x + left.width, 0);
    }
}
