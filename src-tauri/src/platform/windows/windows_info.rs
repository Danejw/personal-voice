//! Read-only window titles. No input is sent to any window.

use crate::platform::WindowReport;
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindowTextW, IsIconic, IsWindowVisible,
};
use windows::core::BOOL;

const LIMIT: usize = 20;
const TITLE_CHARS: usize = 120;

pub fn describe_windows() -> Result<WindowReport, String> {
    let active = foreground_title();
    let mut windows = Vec::new();
    unsafe {
        let ptr = &mut windows as *mut Vec<String>;
        EnumWindows(Some(enum_window), LPARAM(ptr as isize)).map_err(|error| error.to_string())?;
    }
    Ok(WindowReport { active, windows })
}

unsafe extern "system" fn enum_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let titles = &mut *(lparam.0 as *mut Vec<String>);
    if titles.len() < LIMIT && unsafe { IsWindowVisible(hwnd) }.as_bool() && !unsafe { IsIconic(hwnd) }.as_bool() {
        if let Some(title) = title_of(hwnd) {
            titles.push(title);
        }
    }
    true.into()
}

fn foreground_title() -> Option<String> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() || unsafe { IsIconic(hwnd) }.as_bool() {
        return None;
    }
    title_of(hwnd)
}

fn title_of(hwnd: HWND) -> Option<String> {
    let mut buffer = [0u16; 256];
    let length = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    if length <= 0 {
        return None;
    }
    let title = String::from_utf16_lossy(&buffer[..length as usize]).split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        return None;
    }
    Some(clip_title(&title))
}

fn clip_title(title: &str) -> String {
    let mut chars = title.chars();
    let clipped: String = chars.by_ref().take(TITLE_CHARS.saturating_sub(1)).collect();
    if chars.next().is_some() { format!("{clipped}…") } else { title.to_string() }
}
