//! Allowlisted open and shortcut, plus one normalized click.
//! There is no shell command. The id is matched here, not passed to the OS as a path.

use windows::core::w;
use windows::Win32::Foundation::RECT;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_KEYUP, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    MOUSEEVENTF_MOVE, MOUSEINPUT, VIRTUAL_KEY, VK_A, VK_C, VK_CONTROL, VK_ESCAPE, VK_RETURN, VK_TAB,
    VK_V, VK_Z,
};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetSystemMetrics, GetWindowRect, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
    SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SW_SHOWNORMAL,
};

use super::hook::SYNTHETIC_INPUT_MARK;

pub fn open_allowlisted_app(id: &str) -> Result<String, String> {
    let (file, label) = match id {
        "notepad" => (w!("notepad.exe"), "Notepad"),
        "calculator" => (w!("calc.exe"), "Calculator"),
        _ => return Err("That application is not on the allowlist.".into()),
    };
    let result = unsafe { ShellExecuteW(None, w!("open"), file, None, None, SW_SHOWNORMAL) };
    if (result.0 as isize) <= 32 {
        return Err(format!("Windows could not open {label}."));
    }
    Ok(format!("Opened {label}."))
}

pub fn press_allowlisted_shortcut(id: &str) -> Result<String, String> {
    match id {
        "copy" => send_ctrl(VK_C, "Copy"),
        "paste" => send_ctrl(VK_V, "Paste"),
        "select-all" => send_ctrl(VK_A, "Select all"),
        "undo" => send_ctrl(VK_Z, "Undo"),
        "escape" => send_key(VK_ESCAPE, "Escape"),
        "tab" => send_key(VK_TAB, "Tab"),
        "enter" => send_key(VK_RETURN, "Enter"),
        _ => Err("That shortcut is not on the allowlist.".into()),
    }
}

/// Clicks a 0–999 point inside the foreground window, or the primary screen when that window is missing.
pub fn click_normalized(x: i32, y: i32, times: u32) -> Result<String, String> {
    if !(0..=999).contains(&x) || !(0..=999).contains(&y) {
        return Err("The click coordinates were not valid.".into());
    }
    let clicks = times.clamp(1, 2);
    let (left, top, width, height) = target_rect();
    let px = left + x * width / 999;
    let py = top + y * height / 999;
    let (ax, ay) = to_absolute(px, py)?;
    for _ in 0..clicks {
        send_click(ax, ay)?;
    }
    Ok(format!("Clicked at {x}, {y}."))
}

fn target_rect() -> (i32, i32, i32, i32) {
    let hwnd = unsafe { GetForegroundWindow() };
    let mut rect = RECT::default();
    if !hwnd.0.is_null() && unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok() {
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width > 1 && height > 1 {
            return (rect.left, rect.top, width, height);
        }
    }
    let width = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) }.max(1);
    let height = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) }.max(1);
    let left = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let top = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    (left, top, width, height)
}

fn to_absolute(x: i32, y: i32) -> Result<(i32, i32), String> {
    let origin_x = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let origin_y = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    let width = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) }.max(1);
    let height = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) }.max(1);
    Ok((
        (x - origin_x) * 65535 / width,
        (y - origin_y) * 65535 / height,
    ))
}

fn send_click(x: i32, y: i32) -> Result<(), String> {
    let flags = MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE;
    let down = flags | MOUSEEVENTF_LEFTDOWN;
    let up = flags | MOUSEEVENTF_LEFTUP;
    let inputs = [mouse(down, x, y), mouse(up, x, y)];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err("Windows blocked the click.".into())
    }
}

fn mouse(flags: windows::Win32::UI::Input::KeyboardAndMouse::MOUSE_EVENT_FLAGS, x: i32, y: i32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: x,
                dy: y,
                mouseData: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: SYNTHETIC_INPUT_MARK,
            },
        },
    }
}

fn send_ctrl(vk: VIRTUAL_KEY, label: &str) -> Result<String, String> {
    let none = KEYBD_EVENT_FLAGS(0);
    let inputs = [
        key(VK_CONTROL, none),
        key(vk, none),
        key(vk, KEYEVENTF_KEYUP),
        key(VK_CONTROL, KEYEVENTF_KEYUP),
    ];
    send_inputs(&inputs, label)?;
    Ok(format!("Pressed {label}."))
}

fn send_key(vk: VIRTUAL_KEY, label: &str) -> Result<String, String> {
    let inputs = [key(vk, KEYBD_EVENT_FLAGS(0)), key(vk, KEYEVENTF_KEYUP)];
    send_inputs(&inputs, label)?;
    Ok(format!("Pressed {label}."))
}

fn send_inputs(inputs: &[INPUT], label: &str) -> Result<(), String> {
    let sent = unsafe { SendInput(inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err(format!("Windows blocked {label}."))
    }
}

fn key(vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: SYNTHETIC_INPUT_MARK,
            },
        },
    }
}
