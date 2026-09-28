//! Clipboard + Ctrl+V insertion into whichever window is focused at insertion time.
//!
//! The prior clipboard is snapshotted and restored. Only memory-backed (HGLOBAL)
//! formats can be copied; GDI-handle and private formats are skipped. Windows
//! re-synthesizes CF_BITMAP from CF_DIB, but content that exists *only* as a
//! metafile, palette, or private format is not restored.

use std::sync::{Mutex, PoisonError};
use std::thread::{sleep, JoinHandle};
use std::time::Duration;

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData,
    GetClipboardSequenceNumber, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT, VK_V,
};

use super::hook::SYNTHETIC_INPUT_MARK;

const CF_UNICODETEXT: u32 = 13;
/// Long enough for Chromium/Electron apps to read the clipboard asynchronously.
const PASTE_SETTLE: Duration = Duration::from_millis(400);
const SNAPSHOT_LIMIT_BYTES: usize = 64 * 1024 * 1024;

type Snapshot = Vec<(u32, Vec<u8>)>;

/// The clipboard restore still waiting out `PASTE_SETTLE` after the last paste.
static PENDING_RESTORE: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);

/// Returns once the paste keystroke is sent; the clipboard is restored after
/// `PASTE_SETTLE` on a background thread, so dictation is ready again at once.
pub fn insert_text(text: &str) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
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
    let pasted = send_paste();
    *pending = Some(std::thread::spawn(move || {
        sleep(PASTE_SETTLE);
        restore(&previous, ours);
    }));
    pasted
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
    let none = KEYBD_EVENT_FLAGS(0);
    let inputs = [
        key(VK_CONTROL, none),
        key(VK_V, none),
        key(VK_V, KEYEVENTF_KEYUP),
        key(VK_CONTROL, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err(
            "Windows blocked the paste keystroke. The focused app may be running as administrator."
                .into(),
        )
    }
}

fn utf16_bytes(data: &[u16]) -> &[u8] {
    unsafe { std::slice::from_raw_parts(data.as_ptr().cast::<u8>(), std::mem::size_of_val(data)) }
}
