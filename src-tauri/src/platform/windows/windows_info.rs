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

/** Bring an exact-title user-visible window to foreground, never an arbitrary HWND. */
pub fn activate_window(exact_title: &str) -> Result<String, String> {
    use windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow;
    if exact_title.is_empty() || exact_title.len() > 120 {
        return Err("Provide a window title returned by describe_windows.".into());
    }
    struct Search<'a> { target: &'a str, found: Vec<HWND> }
    unsafe extern "system" fn find_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let state = unsafe { &mut *(lparam.0 as *mut Search<'static>) };
        if unsafe { IsWindowVisible(hwnd) }.as_bool() && !unsafe { IsIconic(hwnd) }.as_bool() &&
            title_of(hwnd).as_deref() == Some(state.target) {
            state.found.push(hwnd);
        }
        true.into()
    }
    let mut state = Search { target: exact_title, found: Vec::new() };
    unsafe { EnumWindows(Some(find_window), LPARAM((&mut state as *mut Search<'_>) as isize)) }
        .map_err(|e| e.to_string())?;
    if state.found.len() != 1 {
        return Err(if state.found.is_empty() { "Window not found." } else { "Ambiguous window title." }.into());
    }
    if !unsafe { SetForegroundWindow(state.found[0]) }.as_bool() {
        return Err("Windows prevented changing the foreground window.".into());
    }
    Ok(format!("Focused window '{exact_title}'."))
}
