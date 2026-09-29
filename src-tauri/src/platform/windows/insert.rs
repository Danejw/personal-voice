//! Clipboard + Ctrl+V insertion, and Ctrl+C selection capture, into whichever
//! window is focused at call time.
//!
//! The prior clipboard is snapshotted and restored. Only memory-backed (HGLOBAL)
//! formats can be copied; GDI-handle and private formats are skipped. Windows
//! re-synthesizes CF_BITMAP from CF_DIB, but content that exists *only* as a
//! metafile, palette, or private format is not restored.

use std::sync::{Mutex, PoisonError};
use std::thread::{sleep, JoinHandle};
use std::time::Duration;

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, GlobalFree, HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData,
    GetClipboardSequenceNumber, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_C, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT, VK_V,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
};

use crate::platform::TargetApp;

use super::hook::SYNTHETIC_INPUT_MARK;

const CF_UNICODETEXT: u32 = 13;
/// Long enough for Chromium/Electron apps to read or write the clipboard asynchronously.
const PASTE_SETTLE: Duration = Duration::from_millis(400);
const COPY_SETTLE: Duration = PASTE_SETTLE;
const SNAPSHOT_LIMIT_BYTES: usize = 64 * 1024 * 1024;

type Snapshot = Vec<(u32, Vec<u8>)>;

/// The clipboard restore still waiting out `PASTE_SETTLE` after the last paste.
static PENDING_RESTORE: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);

/// Returns once the paste keystroke is sent; the clipboard is restored after
/// `PASTE_SETTLE` on a background thread, so dictation is ready again at once.
pub fn insert_text(text: &str) -> Result<Option<TargetApp>, String> {
    if text.is_empty() {
        return Ok(None);
    }
    let mut pending = PENDING_RESTORE
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    // A snapshot taken before the previous restore finishes would save our own transcript.
    if let Some(restore) = pending.take() {
        let _ = restore.join();
    }
    let previous = {
        let _open = Clipboard::open()?;
        snapshot()
    };

    let mut utf16: Vec<u16> = text.encode_utf16().collect();
    utf16.push(0);
    {
        let _open = Clipboard::open()?;
        unsafe { EmptyClipboard() }.map_err(|e| format!("Could not clear the clipboard: {e}"))?;
        set_bytes(CF_UNICODETEXT, utf16_bytes(&utf16))?;
        exclude_from_history();
    }
    let ours = unsafe { GetClipboardSequenceNumber() };

    wait_for_modifiers_released();
    // Named at the keystroke, so the identity is the window that receives the paste.
    let target = foreground_app();
    let pasted = send_paste();
    *pending = Some(std::thread::spawn(move || {
        sleep(PASTE_SETTLE);
        restore(&previous, ours);
    }));
    pasted.map(|()| target)
}

/// Copies the focused app's selection, then restores the previous clipboard.
pub fn capture_selection() -> Result<(String, Option<String>), String> {
    finish_pending_restore();
    let source = foreground_title();
    let previous = {
        let _open = Clipboard::open()?;
        snapshot()
    };
    let before = unsafe { GetClipboardSequenceNumber() };
    wait_for_modifiers_released();
    send_copy()?;
    sleep(COPY_SETTLE);
    let after = unsafe { GetClipboardSequenceNumber() };
    if after == before {
        return Err("No text is selected in the other app.".into());
    }
    let text = match clipboard_unicode_text() {
        Ok(text) => text,
        Err(err) => {
            restore(&previous, after);
            return Err(err);
        }
    };
    restore(&previous, after);
    if text.is_empty() {
        return Err("No text is selected in the other app.".into());
    }
    Ok((text, source))
}

/// Lets a restore still in flight finish, so quitting never leaves the transcript on the clipboard.
pub fn finish_pending_restore() {
    let restore = PENDING_RESTORE
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take();
    if let Some(restore) = restore {
        let _ = restore.join();
    }
}

/// Skipped if anything else wrote to the clipboard since our transcript (`ours`).
fn restore(previous: &Snapshot, ours: u32) {
    if unsafe { GetClipboardSequenceNumber() } != ours {
        return;
    }
    if let Ok(_open) = Clipboard::open() {
        let _ = unsafe { EmptyClipboard() };
        for (format, bytes) in previous {
            let _ = set_bytes(*format, bytes);
        }
        if !previous.is_empty() {
            exclude_from_history();
        }
    }
}

struct Clipboard;

impl Clipboard {
    /// Another app may briefly hold the clipboard; retry for up to ~500 ms.
    fn open() -> Result<Self, String> {
        for _ in 0..25 {
            if unsafe { OpenClipboard(None) }.is_ok() {
                return Ok(Self);
            }
            sleep(Duration::from_millis(20));
        }
        Err("The clipboard is busy in another app. Try again.".into())
    }
}

impl Drop for Clipboard {
    fn drop(&mut self) {
        let _ = unsafe { CloseClipboard() };
    }
}

/// Formats whose handle is not HGLOBAL memory, or is owned privately by the source app.
fn is_copyable(format: u32) -> bool {
    !matches!(
        format,
        2 | 3 | 9 | 14 | 0x80 | 0x82 | 0x83 | 0x8E | 0x200..=0x3FF
    )
}

fn snapshot() -> Snapshot {
    let mut formats = Vec::new();
    let mut total = 0;
    let mut format = 0;
    loop {
        format = unsafe { EnumClipboardFormats(format) };
        if format == 0 {
            break;
        }
        if !is_copyable(format) {
            continue;
        }
        let Ok(handle) = (unsafe { GetClipboardData(format) }) else {
            continue;
        };
        let memory = HGLOBAL(handle.0);
        unsafe {
            let size = GlobalSize(memory);
            let data = GlobalLock(memory) as *const u8;
            if data.is_null() {
                continue;
            }
            if total + size <= SNAPSHOT_LIMIT_BYTES {
                formats.push((format, std::slice::from_raw_parts(data, size).to_vec()));
                total += size;
            }
            let _ = GlobalUnlock(memory);
        }
    }
    formats
}

fn set_bytes(format: u32, bytes: &[u8]) -> Result<(), String> {
    unsafe {
        let memory = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1))
            .map_err(|e| format!("Out of memory: {e}"))?;
        let target = GlobalLock(memory) as *mut u8;
        if target.is_null() {
            let _ = GlobalFree(Some(memory));
            return Err("Could not lock clipboard memory.".into());
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), target, bytes.len());
        let _ = GlobalUnlock(memory);
        if SetClipboardData(format, Some(HANDLE(memory.0))).is_err() {
            let _ = GlobalFree(Some(memory));
            return Err("Could not write to the clipboard.".into());
        }
    }
    Ok(())
}

/// Keeps dictated text out of Windows clipboard history, cloud clipboard, and monitors.
fn exclude_from_history() {
    let zero = 0u32.to_le_bytes();
    for name in [
        w!("ExcludeClipboardContentFromMonitorProcessing"),
        w!("CanIncludeInClipboardHistory"),
        w!("CanUploadToCloudClipboard"),
    ] {
        let format = unsafe { RegisterClipboardFormatW(PCWSTR(name.as_ptr())) };
        if format != 0 {
            let _ = set_bytes(format, &zero);
        }
    }
}

/// Shift/Alt/Win still held from the user's own typing would turn Ctrl+V into another chord.
fn wait_for_modifiers_released() {
    let held = || {
        [VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN, VK_CONTROL]
            .iter()
            .any(|vk| unsafe { GetAsyncKeyState(i32::from(vk.0)) } as u16 & 0x8000 != 0)
    };
    for _ in 0..50 {
        if !held() {
            return;
        }
        sleep(Duration::from_millis(20));
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

fn send_paste() -> Result<(), String> {
    send_ctrl(
        VK_V,
        "Windows blocked the paste keystroke. The focused app may be running as administrator.",
    )
}

fn send_copy() -> Result<(), String> {
    send_ctrl(
        VK_C,
        "Windows blocked the copy keystroke. The focused app may be running as administrator.",
    )
}

fn send_ctrl(vk: VIRTUAL_KEY, blocked: &str) -> Result<(), String> {
    let none = KEYBD_EVENT_FLAGS(0);
    let inputs = [
        key(VK_CONTROL, none),
        key(vk, none),
        key(vk, KEYEVENTF_KEYUP),
        key(VK_CONTROL, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err(blocked.into())
    }
}

fn clipboard_unicode_text() -> Result<String, String> {
    let _open = Clipboard::open()?;
    let handle = unsafe { GetClipboardData(CF_UNICODETEXT) }
        .map_err(|_| "No text is selected in the other app.".to_string())?;
    let memory = HGLOBAL(handle.0);
    unsafe {
        let size = GlobalSize(memory);
        let data = GlobalLock(memory) as *const u8;
        if data.is_null() {
            return Err("Could not read the selected text.".into());
        }
        let bytes = std::slice::from_raw_parts(data, size);
        let text = utf16le_nul_terminated(bytes);
        let _ = GlobalUnlock(memory);
        text
    }
}

/// File name of the foreground process. A full path is reduced to that name so a user folder is never kept.
pub fn app_from_image_path(path: &str) -> Option<TargetApp> {
    let file = path.rsplit(['\\', '/']).next()?.trim();
    if file.is_empty() || file == "." || file == ".." {
        return None;
    }
    let id = file.to_lowercase();
    if id.len() > 120 || !id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-') {
        return None;
    }
    let label = known_app_label(&id).unwrap_or_else(|| display_stem(file));
    Some(TargetApp { id, label })
}

fn known_app_label(id: &str) -> Option<String> {
    let label = match id {
        "chrome.exe" => "Chrome",
        "msedge.exe" => "Microsoft Edge",
        "firefox.exe" => "Firefox",
        "slack.exe" => "Slack",
        "notepad.exe" => "Notepad",
        "winword.exe" => "Word",
        "excel.exe" => "Excel",
        "powerpnt.exe" => "PowerPoint",
        "outlook.exe" => "Outlook",
        "code.exe" => "Visual Studio Code",
        "cursor.exe" => "Cursor",
        "notion.exe" => "Notion",
        "discord.exe" => "Discord",
        "telegram.exe" => "Telegram",
        "whatsapp.exe" => "WhatsApp",
        "teams.exe" => "Microsoft Teams",
        "spotify.exe" => "Spotify",
        "explorer.exe" => "File Explorer",
        _ => return None,
    };
    Some(label.to_string())
}

fn display_stem(file: &str) -> String {
    let stem = file
        .strip_suffix(".exe")
        .or_else(|| file.strip_suffix(".EXE"))
        .unwrap_or(file);
    let mut chars = stem.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => file.to_string(),
    }
}

fn foreground_app() -> Option<TargetApp> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_invalid() {
        return None;
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        return None;
    }
    if pid == std::process::id() {
        return Some(TargetApp {
            id: "personal-voice".into(),
            label: "Personal Voice".into(),
        });
    }
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    let named = unsafe {
        QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len)
    };
    unsafe { let _ = CloseHandle(handle); }
    named.ok()?;
    let path = String::from_utf16(&buf[..len as usize]).ok()?;
    app_from_image_path(&path)
}

fn foreground_title() -> Option<String> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_invalid() {
        return None;
    }
    let mut buf = [0u16; 512];
    let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
    if len <= 0 {
        return None;
    }
    String::from_utf16(&buf[..len as usize])
        .ok()
        .filter(|title| !title.is_empty())
}

fn utf16_bytes(data: &[u16]) -> &[u8] {
    unsafe { std::slice::from_raw_parts(data.as_ptr().cast::<u8>(), std::mem::size_of_val(data)) }
}

/// Clipboard `CF_UNICODETEXT` is UTF-16LE, usually NUL-terminated, sometimes with a trailing odd byte.
fn utf16le_nul_terminated(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() < 2 {
        return Ok(String::new());
    }
    let even = bytes.len() & !1;
    let (pairs, _) = bytes[..even].as_chunks::<2>();
    let units: Vec<u16> = pairs
        .iter()
        .map(|chunk| u16::from_le_bytes(*chunk))
        .take_while(|&unit| unit != 0)
        .collect();
    String::from_utf16(&units).map_err(|_| "The selected text is not valid Unicode.".into())
}

#[cfg(test)]
mod tests {
    use super::{app_from_image_path, utf16le_nul_terminated};

    #[test]
    fn image_path_keeps_only_the_file_name() {
        let app = app_from_image_path(r"C:\Users\keali\AppData\Local\Google\Chrome\Application\chrome.exe")
            .expect("chrome");
        assert_eq!(app.id, "chrome.exe");
        assert_eq!(app.label, "Chrome");
        assert!(!app.id.contains("keali"));
    }

    #[test]
    fn unknown_exe_uses_the_stem() {
        let app = app_from_image_path(r"D:\Tools\custom.exe").expect("custom");
        assert_eq!(app.id, "custom.exe");
        assert_eq!(app.label, "Custom");
    }

    #[test]
    fn a_title_is_not_an_app_id() {
        assert!(app_from_image_path("Inbox - Gmail").is_none());
        assert!(app_from_image_path("").is_none());
    }

    #[test]
    fn reads_nul_terminated_utf16le() {
        let mut bytes = Vec::new();
        for unit in "Hi".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&0xABCDu16.to_le_bytes());
        assert_eq!(utf16le_nul_terminated(&bytes).unwrap(), "Hi");
    }

    #[test]
    fn empty_when_only_nul() {
        assert_eq!(utf16le_nul_terminated(&[0, 0]).unwrap(), "");
    }

    #[test]
    fn odd_trailing_byte_is_ignored() {
        let mut bytes = Vec::new();
        for unit in "A".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        bytes.push(0xFF);
        assert_eq!(utf16le_nul_terminated(&bytes).unwrap(), "A");
    }
}
