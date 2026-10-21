//! Event-driven clipboard listener. `AddClipboardFormatListener` wakes a message-only
//! window; nothing polls the clipboard. Changes Personal Voice just wrote are ignored.

use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};

use tauri::{AppHandle, Emitter};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::DataExchange::{AddClipboardFormatListener, RemoveClipboardFormatListener};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, PostMessageW, RegisterClassW,
    HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WNDCLASSW,
};

use super::insert::{
    clipboard_insertion_active, sample_clipboard, write_clipboard_dib, ClipboardImage,
    MAX_CLIPBOARD_DIB_BYTES,
};

const WM_CLIPBOARDUPDATE: u32 = 0x031D;
const WM_QUIT: u32 = 0x0012;

static GENERATION: AtomicU64 = AtomicU64::new(0);
static RUNNING: AtomicBool = AtomicBool::new(false);
static INCLUDE_IMAGES: AtomicBool = AtomicBool::new(false);
static DIRTY: AtomicBool = AtomicBool::new(false);
static PUBLISH_RETRY_PENDING: AtomicBool = AtomicBool::new(false);
static HWND_BITS: AtomicIsize = AtomicIsize::new(0);
static WORKER: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);

/// Starts the listener, or updates the image flag when it is already running.
/// The returned generation lets a later stop ignore a superseded start.
pub fn start_clipboard_watch(app: AppHandle, images: bool) -> Result<u64, String> {
    INCLUDE_IMAGES.store(images, Ordering::SeqCst);
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    if RUNNING.load(Ordering::SeqCst) {
        return Ok(generation);
    }
    RUNNING.store(true, Ordering::SeqCst);
    let handle = thread::spawn(move || watch_loop(app));
    match WORKER.lock() {
        Ok(mut slot) => *slot = Some(handle),
        Err(_) => {
            RUNNING.store(false, Ordering::SeqCst);
            return Err("Clipboard history is busy.".into());
        }
    }
    Ok(generation)
}

/// Stops the listener when `generation` is still the latest start.
pub fn stop_clipboard_watch(generation: u64) {
    if GENERATION.load(Ordering::SeqCst) != generation {
        return;
    }
    RUNNING.store(false, Ordering::SeqCst);
    let raw = HWND_BITS.load(Ordering::SeqCst);
    if raw != 0 {
        let hwnd = HWND(raw as *mut std::ffi::c_void);
        unsafe {
            let _ = PostMessageW(Some(hwnd), WM_QUIT, WPARAM(0), LPARAM(0));
        }
    }
    let handle = WORKER.lock().ok().and_then(|mut slot| slot.take());
    if let Some(handle) = handle {
        let _ = handle.join();
    }
}

/// Copies a BMP the user picked from history onto the clipboard as a DIB.
/// The web layer converts stored PNG entries back to BMP before calling this.
pub fn write_clipboard_image(bmp_base64: &str) -> Result<(), String> {
    let dib = bmp_base64_to_dib(bmp_base64)?;
    write_clipboard_dib(&dib)
}

fn watch_loop(app: AppHandle) {
    let Some(hwnd) = create_listener_window() else {
        RUNNING.store(false, Ordering::SeqCst);
        return;
    };
    HWND_BITS.store(hwnd.0 as isize, Ordering::SeqCst);
    if unsafe { AddClipboardFormatListener(hwnd) }.is_err() {
        RUNNING.store(false, Ordering::SeqCst);
        HWND_BITS.store(0, Ordering::SeqCst);
        return;
    }
    let mut message = MSG::default();
    while unsafe { GetMessageW(&mut message, None, 0, 0) }.as_bool() {
        unsafe { DispatchMessageW(&message); }
        if DIRTY.swap(false, Ordering::SeqCst) {
            publish(&app);
        }
    }
    unsafe { let _ = RemoveClipboardFormatListener(hwnd); }
    HWND_BITS.store(0, Ordering::SeqCst);
    RUNNING.store(false, Ordering::SeqCst);
}

/// Defers sampling while dictation is pasting. A real copy made in that window is
/// sampled once the insertion and its clipboard restore have finished.
fn schedule_publish_retry(app: AppHandle) {
    DIRTY.store(true, Ordering::SeqCst);
    if PUBLISH_RETRY_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(move || {
        for _ in 0..200 {
            if !clipboard_insertion_active() {
                break;
            }
            thread::sleep(std::time::Duration::from_millis(25));
        }
        PUBLISH_RETRY_PENDING.store(false, Ordering::SeqCst);
        if DIRTY.swap(false, Ordering::SeqCst) {
            publish(&app);
        }
    });
}

fn publish(app: &AppHandle) {
    if clipboard_insertion_active() {
        schedule_publish_retry(app.clone());
        return;
    }
    let include_images = INCLUDE_IMAGES.load(Ordering::SeqCst);
    let Ok(Some(sample)) = sample_clipboard(include_images) else {
        return;
    };
    let (image, image_format) = match &sample.image {
        Some(ClipboardImage::Png(bytes)) => (Some(base64_encode(bytes)), Some("png")),
        Some(ClipboardImage::Dib(dib)) => (dib_to_bmp_base64(dib), Some("bmp")),
        None => (None, None),
    };
    if sample.excluded {
        let _ = app.emit_to("main", "clipboard-changed", serde_json::json!({ "excluded": true }));
        return;
    }
    if sample.text.is_none() && image.is_none() {
        return;
    }
    let _ = app.emit_to("main", "clipboard-changed", serde_json::json!({
        "text": sample.text,
        "sourceApp": sample.source_app,
        "sourceProcess": sample.source_process,
        "excluded": false,
        "imageBase64": image,
        "imageFormat": image_format,
    }));
}

unsafe extern "system" fn clipboard_wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_CLIPBOARDUPDATE {
        DIRTY.store(true, Ordering::SeqCst);
        return LRESULT(0);
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

fn create_listener_window() -> Option<HWND> {
    unsafe {
        let instance = GetModuleHandleW(None).ok()?;
        let class = WNDCLASSW {
            style: Default::default(),
            lpfnWndProc: Some(clipboard_wnd_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance.into(),
            hIcon: Default::default(),
            hCursor: Default::default(),
            hbrBackground: Default::default(),
            lpszMenuName: windows::core::PCWSTR::null(),
            lpszClassName: w!("PersonalVoiceClipboardWatch"),
        };
        let _ = RegisterClassW(&class);
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("PersonalVoiceClipboardWatch"),
            w!("Personal Voice clipboard"),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(instance.into()),
            None,
        )
        .ok()
    }
}

/// Wraps a 24- or 32-bit DIB in a BMP. The raw bytes are a transport format only;
/// TypeScript re-encodes the image as PNG before it is stored or synced.
fn dib_to_bmp_base64(dib: &[u8]) -> Option<String> {
    if dib.len() < 40 || dib.len() > MAX_CLIPBOARD_DIB_BYTES {
        return None;
    }
    let header = u32::from_le_bytes(dib[0..4].try_into().ok()?);
    if header < 40 {
        return None;
    }
    let width = i32::from_le_bytes(dib[4..8].try_into().ok()?);
    let height = i32::from_le_bytes(dib[8..12].try_into().ok()?);
    let planes = u16::from_le_bytes(dib[12..14].try_into().ok()?);
    let depth = u16::from_le_bytes(dib[14..16].try_into().ok()?);
    let compression = u32::from_le_bytes(dib[16..20].try_into().ok()?);
    if planes != 1
        || (compression != 0 && compression != 3)
        || width == 0
        || width.unsigned_abs() > 8192
        || height == 0
        || height.unsigned_abs() > 8192
        || (depth != 24 && depth != 32)
    {
        return None;
    }
    // BI_BITFIELDS with a 40-byte header keeps its three masks after the header.
    // Larger headers, including BITMAPV5HEADER, already contain them.
    let masks = if compression == 3 && header == 40 { 12 } else { 0 };
    let file_size = 14 + dib.len();
    let mut file = Vec::with_capacity(file_size);
    file.extend_from_slice(b"BM");
    file.extend_from_slice(&(file_size as u32).to_le_bytes());
    file.extend_from_slice(&0u32.to_le_bytes());
    file.extend_from_slice(&(14 + header + masks).to_le_bytes());
    file.extend_from_slice(dib);
    Some(base64_encode(&file))
}

fn bmp_base64_to_dib(input: &str) -> Result<Vec<u8>, String> {
    let bytes = base64_decode(input)?;
    if bytes.len() < 54 || &bytes[0..2] != b"BM" {
        return Err("That image could not be copied.".into());
    }
    let offset = u32::from_le_bytes([bytes[10], bytes[11], bytes[12], bytes[13]]) as usize;
    if offset >= bytes.len() || bytes.len() - offset > MAX_CLIPBOARD_DIB_BYTES {
        return Err("That image is too large to copy.".into());
    }
    Ok(bytes[offset..].to_vec())
}

fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let value = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((value >> 18) & 63) as usize] as char);
        out.push(TABLE[((value >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[((value >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(value & 63) as usize] as char } else { '=' });
    }
    out
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    // Base64 of the largest DIB we accept, rounded up.
    if input.len() > 45_000_000 || input.len() % 4 != 0 {
        return Err("That image could not be copied.".into());
    }
    let mut out = Vec::with_capacity(input.len() / 4 * 3);
    let bytes = input.as_bytes();
    for (index, group) in bytes.chunks_exact(4).enumerate() {
        let mut value = [0u8; 4];
        for (i, byte) in group.iter().copied().enumerate() {
            value[i] = match byte {
                b'A'..=b'Z' => byte - b'A',
                b'a'..=b'z' => byte - b'a' + 26,
                b'0'..=b'9' => byte - b'0' + 52,
                b'+' => 62,
                b'/' => 63,
                b'=' if index == bytes.len() / 4 - 1 && i >= 2 => 0,
                _ => return Err("That image could not be copied.".into()),
            };
        }
        let padding = usize::from(group[3] == b'=') + usize::from(group[2] == b'=');
        if padding > 0 && index != bytes.len() / 4 - 1 {
            return Err("That image could not be copied.".into());
        }
        let triple = (u32::from(value[0]) << 18)
            | (u32::from(value[1]) << 12)
            | (u32::from(value[2]) << 6)
            | u32::from(value[3]);
        for shift in [16u32, 8, 0].into_iter().take(3 - padding) {
            out.push((triple >> shift) as u8);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::dib_to_bmp_base64;

    #[test]
    fn wraps_a_small_bitmap() {
        let mut dib = vec![0u8; 44];
        dib[0..4].copy_from_slice(&40u32.to_le_bytes());
        dib[4..8].copy_from_slice(&1i32.to_le_bytes());
        dib[8..12].copy_from_slice(&1i32.to_le_bytes());
        dib[12..14].copy_from_slice(&1u16.to_le_bytes());
        dib[14..16].copy_from_slice(&32u16.to_le_bytes());
        let encoded = dib_to_bmp_base64(&dib).expect("bitmap");
        assert!(encoded.starts_with("Qk"));
    }

    #[test]
    fn wraps_a_snip_sized_top_down_bitmap() {
        // 1000 by 600 at 32 bits per pixel is about 2.4 MB of raw data. The old
        // 1.5 MB cap dropped snips like this before they reached history.
        let mut dib = vec![0u8; 40 + 1000 * 600 * 4];
        dib[0..4].copy_from_slice(&40u32.to_le_bytes());
        dib[4..8].copy_from_slice(&1000i32.to_le_bytes());
        dib[8..12].copy_from_slice(&(-600i32).to_le_bytes());
        dib[12..14].copy_from_slice(&1u16.to_le_bytes());
        dib[14..16].copy_from_slice(&32u16.to_le_bytes());
        assert!(dib_to_bmp_base64(&dib).is_some());
    }
}
