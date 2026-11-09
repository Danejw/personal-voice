//! Allowlisted open and shortcut, plus one normalized click.
//! There is no shell command. The id is matched here, not passed to the OS as a path.

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::RECT;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_KEYUP, MOUSEEVENTF_ABSOLUTE,
    MOUSEEVENTF_MOVE, MOUSEEVENTF_VIRTUALDESK, MOUSEEVENTF_WHEEL, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEINPUT, VIRTUAL_KEY, VK_A, VK_C, VK_CONTROL, VK_ESCAPE, VK_RETURN, VK_TAB,
    VK_V, VK_Z, VK_S, VK_O, VK_F, VK_L, VK_T, VK_MENU, VK_SHIFT,
};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetSystemMetrics, GetWindowRect, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
    SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SW_SHOWNORMAL,
};

use super::hook::SYNTHETIC_INPUT_MARK;

/// Launch an installed executable by filename without a shell, path, arguments, or URL.
pub fn open_allowlisted_app(id: &str) -> Result<String, String> {
    if !id.to_ascii_lowercase().ends_with(".exe") && id != "notepad" && id != "calculator" {
        return super::installed_apps::open_start_menu_app(id);
    }
    let label = match id {
        "notepad" => "notepad.exe",
        "calculator" => "calc.exe",
        _ => id,
    };
    if label.len() > 84 || label.contains("..") ||
       !label.to_ascii_lowercase().ends_with(".exe") ||
       !label.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'_')) {
        return Err("Provide an executable name only, without paths, arguments or commands.".into());
    }
    let lower = label.to_ascii_lowercase();
    let base = lower.strip_suffix(".exe").unwrap_or(&lower);
    if ["cmd", "powershell", "pwsh", "wscript", "cscript", "mshta", "rundll32",
        "regsvr32", "reg", "schtasks", "wmic", "bash", "sh", "wsl",
        "python", "py", "node", "npm", "npx"].contains(&base) {
        return Err("Command shells and interpreters are blocked.".into());
    }
    let wide: Vec<u16> = label.encode_utf16().chain(std::iter::once(0)).collect();
    let result = unsafe { ShellExecuteW(None, w!("open"), PCWSTR(wide.as_ptr()), None, None, SW_SHOWNORMAL) };
    if (result.0 as isize) <= 32 {
        return Err(format!("Windows could not open {label}. Check the application name or installation."));
    }
    Ok(format!("Opened {label}."))
}

pub fn press_allowlisted_shortcut(id: &str) -> Result<String, String> {
    match id {
        "copy" => send_ctrl(VK_C, "Copy"),
        "paste" => send_ctrl(VK_V, "Paste"),
        "select-all" => send_ctrl(VK_A, "Select all"),
        "undo" => send_ctrl(VK_Z, "Undo"),
        "save" => send_ctrl(VK_S, "Save"),
        "save-as" => send_modified(&[VK_CONTROL, VK_SHIFT], VK_S, "Save as"),
        "open-file" => send_ctrl(VK_O, "Open file"),
        "find" => send_ctrl(VK_F, "Find"),
        "address-bar" => send_ctrl(VK_L, "Address bar"),
        "new-tab" => send_ctrl(VK_T, "New tab"),
        "switch-window" => send_modified(&[VK_MENU], VK_TAB, "Switch window"),
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


static POINTER_ACTION_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn point(x: i32, y: i32) -> Result<(i32, i32), String> {
    if !(0..=999).contains(&x) || !(0..=999).contains(&y) {
        return Err("Pointer coordinates must be between 0 and 999.".into());
    }
    let (left, top, width, height) = target_rect();
    to_absolute(left.saturating_add((x as i64 * (width - 1) as i64 / 999) as i32),
                top.saturating_add((y as i64 * (height - 1) as i64 / 999) as i32))
}

fn pointer_event(flags: windows::Win32::UI::Input::KeyboardAndMouse::MOUSE_EVENT_FLAGS, x: i32, y: i32, data: i32) -> Result<(), String> {
    let _ = data;
    send_inputs(&[mouse(flags, x, y)], "pointer action")
}

fn pointer_move(from: (i32, i32), to: (i32, i32), on_step: &mut impl FnMut(i32, i32)) -> Result<(), String> {
    // Move the actual Windows cursor in short visible increments, not a simulated UI indicator.
    // Every action is serialized to avoid overlapping drags or clicks.
    const STEPS: i64 = 12;
    for i in 1..=STEPS {
        let x = (from.0 as i64 + (to.0 as i64 - from.0 as i64) * i / STEPS) as i32;
        let y = (from.1 as i64 + (to.1 as i64 - from.1 as i64) * i / STEPS) as i32;
        pointer_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, x, y, 0)?;
        on_step(x, y);
        std::thread::sleep(std::time::Duration::from_millis(12));
    }
    Ok(())
}

/// Supervised local desktop pointer actions. Never exposed as trusted remote commands.
/// Drag always releases the button, including when a movement fails.
pub fn pointer_action(kind: &str, x: i32, y: i32, end_x: Option<i32>, end_y: Option<i32>, mut on_step: impl FnMut(i32, i32)) -> Result<String, String> {
    let _lock = POINTER_ACTION_LOCK.lock().map_err(|_| "Pointer controller unavailable.")?;
    let destination = point(x, y)?;
    let endpoint = if kind == "drag" {
        Some(point(end_x.ok_or("Drag endpoint X is required.")?,
                   end_y.ok_or("Drag endpoint Y is required.")?)?)
    } else {
        if end_x.is_some() || end_y.is_some() { return Err("Unexpected pointer endpoint.".into()); }
        None
    };
    if !["move", "click", "double_click", "right_click", "drag", "scroll_up", "scroll_down", "scroll_left", "scroll_right"].contains(&kind) {
        return Err("Unsupported pointer action.".into());
    }
    let mut current = windows::Win32::Foundation::POINT::default();
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    unsafe { GetCursorPos(&mut current) }.map_err(|e| e.to_string())?;
    let origin = to_absolute(current.x, current.y)?;
    pointer_move(origin, destination, &mut on_step)?;
    match kind {
        "move" => Ok("Moved the visible Windows pointer.".into()),
        "click" | "double_click" => {
            let click_count = if kind == "double_click" { 2 } else { 1 };
            for _ in 0..click_count {
                pointer_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0)?;
                pointer_event(MOUSEEVENTF_LEFTUP, 0, 0, 0)?;
            }
            Ok("Clicked the target with visible pointer movement.".into())
        }
        "right_click" => {
            pointer_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0)?;
            pointer_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0)?;
            Ok("Right-clicked the target.".into())
        }
        "drag" => {
            pointer_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0)?;
            let moved = pointer_move(destination, endpoint.expect("validated endpoint"), &mut on_step);
            let released = pointer_event(MOUSEEVENTF_LEFTUP, 0, 0, 0);
            moved?;
            released?;
            Ok("Dragged and released the target.".into())
        }
        "scroll_up" | "scroll_down" | "scroll_left" | "scroll_right" => {
            // Wheel events are sent at the visible cursor after the same serialized move
            // as clicks and drags. Vertical and horizontal delta are one standard notch.
            let (flags, delta) = match kind {
                "scroll_up" => (MOUSEEVENTF_WHEEL, 120),
                "scroll_down" => (MOUSEEVENTF_WHEEL, -120),
                "scroll_left" => (MOUSEEVENTF_HWHEEL, -120),
                "scroll_right" => (MOUSEEVENTF_HWHEEL, 120),
                _ => unreachable!(),
            };
            send_inputs(&[wheel_input(flags, delta)], "scroll")?;
            Ok(format!("Scrolled {}.", &kind[7..]))
        }
        _ => unreachable!(),
    }
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
        ((x - origin_x).clamp(0, width - 1) as i64 * 65535 / (width - 1).max(1) as i64) as i32,
        ((y - origin_y).clamp(0, height - 1) as i64 * 65535 / (height - 1).max(1) as i64) as i32,
    ))
}

fn send_click(x: i32, y: i32) -> Result<(), String> {
    let flags = MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK | MOUSEEVENTF_MOVE;
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

fn wheel_input(flags: windows::Win32::UI::Input::KeyboardAndMouse::MOUSE_EVENT_FLAGS, delta: i32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0, dy: 0, mouseData: delta as u32,
                dwFlags: flags, time: 0, dwExtraInfo: SYNTHETIC_INPUT_MARK,
            },
        },
    }
}

fn send_ctrl(vk: VIRTUAL_KEY, label: &str) -> Result<String, String> {
    send_modified(&[VK_CONTROL], vk, label)
}

/// Emit only hard-coded modifier/key combinations. Release the modifiers in
/// reverse order so keyboard focus is not left with Ctrl, Shift or Alt held.
fn send_modified(modifiers: &[VIRTUAL_KEY], vk: VIRTUAL_KEY, label: &str) -> Result<String, String> {
    let mut inputs = Vec::with_capacity(modifiers.len() * 2 + 2);
    for modifier in modifiers { inputs.push(key(*modifier, KEYBD_EVENT_FLAGS(0))); }
    inputs.push(key(vk, KEYBD_EVENT_FLAGS(0)));
    inputs.push(key(vk, KEYEVENTF_KEYUP));
    for modifier in modifiers.iter().rev() { inputs.push(key(*modifier, KEYEVENTF_KEYUP)); }
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
