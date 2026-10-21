//! Clipboard + Ctrl+V insertion, and Ctrl+C selection capture, into whichever
//! window is focused at call time.
//!
//! The prior clipboard is snapshotted and restored. Only memory-backed (HGLOBAL)
//! formats can be copied; GDI-handle and private formats are skipped. Windows
//! re-synthesizes CF_BITMAP from CF_DIB, but content that exists *only* as a
//! metafile, palette, or private format is not restored.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::thread::{sleep, JoinHandle};
use std::time::Duration;

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, GlobalFree, HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, EnumClipboardFormats,     GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard,
    RegisterClipboardFormatW, SetClipboardData,
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
const CF_DIB: u32 = 8;
const CF_DIBV5: u32 = 17;
/// Raw bitmaps are only a transport format. TypeScript re-encodes them as PNG before storage.
pub(crate) const MAX_CLIPBOARD_DIB_BYTES: usize = 33_554_432;
pub(crate) const MAX_CLIPBOARD_PNG_BYTES: usize = 10_485_760;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
/// Long enough for Chromium/Electron apps to read or write the clipboard asynchronously.
const PASTE_SETTLE: Duration = Duration::from_millis(400);
const COPY_SETTLE: Duration = PASTE_SETTLE;
const SNAPSHOT_LIMIT_BYTES: usize = 64 * 1024 * 1024;

type Snapshot = Vec<(u32, Vec<u8>)>;

/// The clipboard restore still waiting out `PASTE_SETTLE` after the last paste.
static PENDING_RESTORE: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);
static CLIPBOARD_WRITING: AtomicBool = AtomicBool::new(false);
static CLIPBOARD_WRITE_START: AtomicU32 = AtomicU32::new(0);
static OWNED_SEQUENCES: Mutex<Vec<u32>> = Mutex::new(Vec::new());
/// Serializes Personal Voice clipboard reads and writes. The focused app is not part of
/// this lock, so insertion keeps a separate activity count through its paste window.
static CLIPBOARD_ACCESS: Mutex<()> = Mutex::new(());
static CLIPBOARD_INSERTION_COUNT: AtomicUsize = AtomicUsize::new(0);

pub(crate) fn clipboard_access() -> MutexGuard<'static, ()> {
    CLIPBOARD_ACCESS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

pub(crate) fn clipboard_insertion_active() -> bool {
    CLIPBOARD_INSERTION_COUNT.load(Ordering::SeqCst) > 0
}

/// One insertion in progress. The count lets a new insertion start while the previous
/// insertion's delayed restore is finishing without opening a sampling window.
struct ClipboardInsertion {
    armed: bool,
}

impl ClipboardInsertion {
    fn begin() -> Self {
        CLIPBOARD_INSERTION_COUNT.fetch_add(1, Ordering::SeqCst);
        Self { armed: true }
    }

    /// Keeps the count raised after this value is dropped. The restore thread releases it.
    fn hand_off(mut self) {
        self.armed = false;
    }

    fn release() {
        let _ =
            CLIPBOARD_INSERTION_COUNT.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
                Some(count.saturating_sub(1))
            });
    }
}

impl Drop for ClipboardInsertion {
    fn drop(&mut self) {
        if self.armed {
            Self::release();
        }
    }
}

/// Marks clipboard changes Personal Voice itself makes so the history listener can ignore them.
struct ClipboardWrite;

impl ClipboardWrite {
    fn begin() -> Self {
        CLIPBOARD_WRITE_START.store(unsafe { GetClipboardSequenceNumber() }, Ordering::SeqCst);
        CLIPBOARD_WRITING.store(true, Ordering::SeqCst);
        Self
    }
}

impl Drop for ClipboardWrite {
    fn drop(&mut self) {
        let start = CLIPBOARD_WRITE_START.load(Ordering::SeqCst);
        let end = unsafe { GetClipboardSequenceNumber() };
        if end != start {
            if let Ok(mut owned) = OWNED_SEQUENCES.lock() {
                if !owned.contains(&end) {
                    owned.push(end);
                }
                if owned.len() > 32 {
                    owned.remove(0);
                }
            }
        }
        CLIPBOARD_WRITING.store(false, Ordering::SeqCst);
    }
}

/// True while Personal Voice is writing the clipboard, or the current contents are that write.
pub(crate) fn clipboard_change_is_ours() -> bool {
    if CLIPBOARD_WRITING.load(Ordering::SeqCst) {
        return true;
    }
    let sequence = unsafe { GetClipboardSequenceNumber() };
    OWNED_SEQUENCES
        .lock()
        .map(|owned| owned.contains(&sequence))
        .unwrap_or(false)
}

/// Returns once the paste keystroke is sent; the clipboard is restored after
/// `PASTE_SETTLE` on a background thread, so dictation is ready again at once.
pub fn insert_text(text: &str) -> Result<Option<TargetApp>, String> {
    if text.is_empty() {
        return Ok(None);
    }
    // Raised before the previous restore can finish, and held until this insertion's
    // restore finishes. The history watcher must not open the clipboard in between.
    let insertion = ClipboardInsertion::begin();
    let mut pending = PENDING_RESTORE
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    // A snapshot taken before the previous restore finishes would save our own transcript.
    if let Some(restore) = pending.take() {
        let _ = restore.join();
    }
    let (previous, ours) = {
        let _access = clipboard_access();
        let previous = {
            let _open = Clipboard::open()?;
            snapshot()
        };

        let mut utf16: Vec<u16> = text.encode_utf16().collect();
        utf16.push(0);
        {
            let _write = ClipboardWrite::begin();
            let _open = Clipboard::open()?;
            unsafe { EmptyClipboard() }.map_err(|e| format!("Could not clear the clipboard: {e}"))?;
            set_bytes(CF_UNICODETEXT, utf16_bytes(&utf16))?;
            exclude_from_history();
        }
        let ours = unsafe { GetClipboardSequenceNumber() };
        (previous, ours)
    };

    wait_for_modifiers_released();
    // Named at the keystroke, so the identity is the window that receives the paste.
    let target = foreground_app();
    let pasted = send_paste();
    *pending = Some(std::thread::spawn(move || {
        sleep(PASTE_SETTLE);
        {
            let _access = clipboard_access();
            let _write = ClipboardWrite::begin();
            restore(&previous, ours);
        }
        ClipboardInsertion::release();
    }));
    insertion.hand_off();
    pasted.map(|()| target)
}

/// Replaces the clipboard with text the user chose from history. Does not paste into the focused app.
pub fn write_clipboard_text(text: &str) -> Result<(), String> {
    if text.is_empty() {
        return Err("Nothing to copy.".into());
    }
    let mut utf16: Vec<u16> = text.encode_utf16().collect();
    utf16.push(0);
    let _access = clipboard_access();
    let _write = ClipboardWrite::begin();
    let _open = Clipboard::open()?;
    unsafe { EmptyClipboard() }.map_err(|e| format!("Could not clear the clipboard: {e}"))?;
    set_bytes(CF_UNICODETEXT, utf16_bytes(&utf16))
}

/// Replaces the clipboard with a DIB the user chose from history.
pub fn write_clipboard_dib(dib: &[u8]) -> Result<(), String> {
    if dib.len() < 40 || dib.len() > MAX_CLIPBOARD_DIB_BYTES {
        return Err("That image is too large to copy.".into());
    }
    let _access = clipboard_access();
    let _write = ClipboardWrite::begin();
    let _open = Clipboard::open()?;
    unsafe { EmptyClipboard() }.map_err(|e| format!("Could not clear the clipboard: {e}"))?;
    set_bytes(CF_DIB, dib)
}

/// Paste a real bitmap into a user-selected field on another app.
pub fn insert_camera_image(dib_base64: &str, expected_window: &str) -> Result<String, String> {
    if expected_window.trim().is_empty() || expected_window.chars().count() > 200 {
        return Err("Specify an exact target window title.".into());
    }
    let dib = decode_base64_limited(dib_base64, 12 * 1024 * 1024)?;
    if dib.len() < 40 { return Err("Invalid bitmap data.".into()); }
    let header = u32::from_le_bytes(dib[0..4].try_into().unwrap_or([0; 4]));
    let width = i32::from_le_bytes(dib[4..8].try_into().unwrap_or([0; 4]));
    let height = i32::from_le_bytes(dib[8..12].try_into().unwrap_or([0; 4]));
    let planes = u16::from_le_bytes(dib[12..14].try_into().unwrap_or([0; 2]));
    let depth = u16::from_le_bytes(dib[14..16].try_into().unwrap_or([0; 2]));
    let compression = u32::from_le_bytes(dib[16..20].try_into().unwrap_or([0; 4]));
    if header != 40 || planes != 1 || depth != 32 || compression != 0 ||
       width < 1 || height < 1 || width > 1600 || height > 1600 ||
       dib.len() != 40 + (width as usize * height as usize * 4) {
        return Err("Unsupported camera bitmap format.".into());
    }
    let mut pending = PENDING_RESTORE.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(restore) = pending.take() { let _ = restore.join(); }
    if foreground_title().as_deref() != Some(expected_window) {
        return Err("The target window is not focused. Focus its input field and retry.".into());
    }
    let previous = {
        let _open = Clipboard::open()?;
        snapshot()
    };
    let ours = {
        let _write = ClipboardWrite::begin();
        {
            let _open = Clipboard::open()?;
            unsafe { EmptyClipboard() }.map_err(|e| format!("Could not clear the clipboard: {e}"))?;
            if let Err(error) = set_bytes(CF_DIB, &dib) {
                drop(_open);
                let changed = unsafe { GetClipboardSequenceNumber() };
                restore(&previous, changed);
                return Err(error);
            }
            exclude_from_history();
        }
        let ours = unsafe { GetClipboardSequenceNumber() };
        wait_for_modifiers_released();
        if foreground_title().as_deref() != Some(expected_window) {
            restore(&previous, ours);
            return Err("Focus changed before image paste. No image was inserted.".into());
        }
        ours
    };
    let result = send_paste();
    *pending = Some(std::thread::spawn(move || {
        sleep(PASTE_SETTLE + Duration::from_millis(350));
        let _write = ClipboardWrite::begin();
        restore(&previous, ours);
    }));
    result?;
    Ok(format!("Pasted camera image into '{expected_window}'. Check that the attachment appears before sending."))
}

fn decode_base64_limited(input: &str, max_len: usize) -> Result<Vec<u8>, String> {
    if input.len() > ((max_len + 2) / 3) * 4 + 4 || input.len() % 4 != 0 {
        return Err("Camera image exceeds clipboard size limit.".into());
    }
    let mut out = Vec::with_capacity(input.len() / 4 * 3);
    let bytes = input.as_bytes();
    for (index, group) in bytes.chunks_exact(4).enumerate() {
        let mut v = [0u8; 4];
        for (i, byte) in group.iter().copied().enumerate() {
            v[i] = match byte {
                b'A'..=b'Z' => byte - b'A',
                b'a'..=b'z' => byte - b'a' + 26,
                b'0'..=b'9' => byte - b'0' + 52,
                b'+' => 62,
                b'/' => 63,
                b'=' if index == bytes.len() / 4 - 1 && i >= 2 => 0,
                _ => return Err("Invalid camera bitmap encoding.".into()),
            };
        }
        let padding = usize::from(group[3] == b'=') + usize::from(group[2] == b'=');
        if padding > 0 && index != bytes.len() / 4 - 1 { return Err("Invalid padding.".into()); }
        let triple = (u32::from(v[0]) << 18) | (u32::from(v[1]) << 12) |
                     (u32::from(v[2]) << 6) | u32::from(v[3]);
        for shift in [16u32, 8, 0].into_iter().take(3 - padding) {
            out.push((triple >> shift) as u8);
        }
    }
    if out.len() > max_len { return Err("Camera image exceeds clipboard size limit.".into()); }
    Ok(out)
}

/// Copies the focused app's selection. Restores the previous clipboard unless `leave_on_clipboard`.
pub fn capture_selection(leave_on_clipboard: bool) -> Result<(String, Option<String>), String> {
    finish_pending_restore();
    let _insertion = ClipboardInsertion::begin();
    let _access = clipboard_access();
    let _write = ClipboardWrite::begin();
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
    if text.is_empty() {
        restore(&previous, after);
        return Err("No text is selected in the other app.".into());
    }
    if !leave_on_clipboard {
        restore(&previous, after);
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

/// Image formats Personal Voice can take from the clipboard. PNG is preferred because
/// Snipping Tool and browsers publish it directly, already compressed.
pub(crate) enum ClipboardImage {
    Png(Vec<u8>),
    Dib(Vec<u8>),
}

pub(crate) struct ClipboardSample {
    pub text: Option<String>,
    pub excluded: bool,
    pub image: Option<ClipboardImage>,
    pub source_app: Option<String>,
    pub source_process: Option<String>,
}

/// Reads the current clipboard once. Returns `None` when Personal Voice wrote it or it has no
/// supported content. Excluded content is reported without the bytes.
pub(crate) fn sample_clipboard(include_image: bool) -> Result<Option<ClipboardSample>, String> {
    // Wait for any Personal Voice clipboard write, then refuse to open the clipboard
    // while an insertion is waiting for the focused app to read its paste.
    let _access = clipboard_access();
    if clipboard_insertion_active() || clipboard_change_is_ours() {
        return Ok(None);
    }
    let source = foreground_app();
    let source_process = source.as_ref().map(|app| app.id.clone());
    let source_app = source.map(|app| app.label);
    let _open = Clipboard::open()?;
    if clipboard_insertion_active() || clipboard_change_is_ours() {
        return Ok(None);
    }
    if clipboard_history_excluded() {
        return Ok(Some(ClipboardSample {
            text: None,
            excluded: true,
            image: None,
            source_app,
            source_process,
        }));
    }
    let text = read_format_bytes(CF_UNICODETEXT)
        .and_then(|bytes| utf16le_nul_terminated(&bytes).ok())
        .filter(|text| !text.is_empty());
    let image = if include_image && text.is_none() {
        read_clipboard_image()
    } else {
        None
    };
    if text.is_none() && image.is_none() {
        return Ok(None);
    }
    Ok(Some(ClipboardSample {
        text,
        excluded: false,
        image,
        source_app,
        source_process,
    }))
}

fn clipboard_history_excluded() -> bool {
    let exclude = unsafe { RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing")) };
    if exclude != 0 && unsafe { IsClipboardFormatAvailable(exclude) }.is_ok() {
        return true;
    }
    let include = unsafe { RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory")) };
    if include == 0 {
        return false;
    }
    match read_format_bytes(include) {
        Some(bytes) if bytes.len() >= 4 => u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) == 0,
        _ => false,
    }
}

/// Prefers the compressed PNG many tools publish, then the modern DIBV5, then plain DIB.
fn read_clipboard_image() -> Option<ClipboardImage> {
    for png_format in [
        unsafe { RegisterClipboardFormatW(w!("PNG")) },
        unsafe { RegisterClipboardFormatW(w!("image/png")) },
    ] {
        if png_format == 0 {
            continue;
        }
        if let Some(bytes) = read_format_bytes_with_limit(png_format, MAX_CLIPBOARD_PNG_BYTES) {
            if is_png(&bytes) {
                return Some(ClipboardImage::Png(bytes));
            }
        }
    }
    read_format_bytes_with_limit(CF_DIBV5, MAX_CLIPBOARD_DIB_BYTES)
        .map(ClipboardImage::Dib)
        .or_else(|| read_format_bytes_with_limit(CF_DIB, MAX_CLIPBOARD_DIB_BYTES).map(ClipboardImage::Dib))
}

fn is_png(bytes: &[u8]) -> bool {
    bytes.len() >= PNG_SIGNATURE.len() && bytes[..PNG_SIGNATURE.len()] == PNG_SIGNATURE
}

fn read_format_bytes(format: u32) -> Option<Vec<u8>> {
    read_format_bytes_with_limit(format, 2_000_000)
}

fn read_format_bytes_with_limit(format: u32, limit: usize) -> Option<Vec<u8>> {
    let handle = unsafe { GetClipboardData(format) }.ok()?;
    let memory = HGLOBAL(handle.0);
    unsafe {
        let size = GlobalSize(memory);
        if size == 0 || size > limit {
            return None;
        }
        let data = GlobalLock(memory) as *const u8;
        if data.is_null() {
            return None;
        }
        let bytes = std::slice::from_raw_parts(data, size).to_vec();
        let _ = GlobalUnlock(memory);
        Some(bytes)
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
    use super::{
        app_from_image_path, clipboard_insertion_active, decode_base64_limited, is_png,
        utf16le_nul_terminated, ClipboardInsertion,
    };

    #[test]
    fn insertion_stays_active_after_handoff_until_the_restore_releases_it() {
        assert!(!clipboard_insertion_active());
        let insertion = ClipboardInsertion::begin();
        assert!(clipboard_insertion_active());
        insertion.hand_off();
        assert!(clipboard_insertion_active());
        ClipboardInsertion::release();
        assert!(!clipboard_insertion_active());
    }

    #[test]
    fn recognizes_only_a_real_png_signature() {
        assert!(is_png(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0]));
        assert!(!is_png(b"BMxxxxxx"));
        assert!(!is_png(&[0x89, b'P']));
    }

    #[test]
    fn camera_clipboard_base64_decoding_rejects_bad_input() {
        assert_eq!(decode_base64_limited("AQIDBA==", 4).unwrap(), [1u8, 2, 3, 4]);
        assert!(decode_base64_limited("!!!!", 10).is_err());
        assert!(decode_base64_limited("AQIDBA==", 3).is_err());
    }

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
