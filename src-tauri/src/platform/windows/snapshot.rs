//! One explicit screenshot of the active window, or the primary screen when that
//! window cannot be read. Pixels stay in the returned buffer. Nothing is written to disk.

use crate::platform::SnapshotFrame;
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    SRCCOPY,
};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetCursorPos, GetForegroundWindow, GetSystemMetrics, GetWindowRect,
    GetWindowTextW, GetWindowThreadProcessId, IsIconic, WindowFromPoint, GA_ROOT,
    SM_CXSCREEN, SM_CYSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
};

const MAX_EDGE: i32 = 1_600;

pub fn capture_snapshot() -> Result<SnapshotFrame, String> {
    let foreground = unsafe { GetForegroundWindow() };
    if let Some(frame) = capture_window(foreground) {
        return Ok(frame);
    }
    capture_screen()
}

/// Read one explicitly requested screenshot of the pointed-at window, with a
/// visible crosshair at the pointer. No continuous pixel capture or disk write.
pub fn capture_pointer_snapshot() -> Result<SnapshotFrame, String> {
    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point) }.map_err(|e| format!("Cannot locate pointer: {e}"))?;
    let hovered = unsafe { WindowFromPoint(point) };
    if !hovered.0.is_null() {
        let root = unsafe { GetAncestor(hovered, GA_ROOT) };
        let hwnd = if root.0.is_null() { hovered } else { root };
        if let Some(frame) = capture_window_at(hwnd, Some(point)) { return Ok(frame); }
    }
    capture_virtual_screen_at(point)
}

fn capture_window(hwnd: HWND) -> Option<SnapshotFrame> {
    capture_window_at(hwnd, None)
}

fn capture_window_at(hwnd: HWND, pointer: Option<POINT>) -> Option<SnapshotFrame> {
    if hwnd.0.is_null() || is_our_process(hwnd) || unsafe { IsIconic(hwnd) }.as_bool() {
        return None;
    }
    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return None;
    }
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if width < 2 || height < 2 {
        return None;
    }
    let mut pixels = blit(rect.left, rect.top, width, height).ok()?;
    if let Some(point) = pointer {
        mark_cursor(&mut pixels, point.x - rect.left, point.y - rect.top, width, height);
    }
    Some(SnapshotFrame {
        source: "window",
        source_app: window_title(hwnd),
        width: pixels.width,
        height: pixels.height,
        rgba: encode_base64(&pixels.rgba),
    })
}

fn capture_screen() -> Result<SnapshotFrame, String> {
    let width = unsafe { GetSystemMetrics(SM_CXSCREEN) };
    let height = unsafe { GetSystemMetrics(SM_CYSCREEN) };
    if width < 2 || height < 2 {
        return Err("Couldn't capture the screen.".into());
    }
    let pixels = blit(0, 0, width, height)?;
    Ok(SnapshotFrame {
        source: "screen",
        source_app: None,
        width: pixels.width,
        height: pixels.height,
        rgba: encode_base64(&pixels.rgba),
    })
}

/// Virtual screen covers secondary monitors with negative x/y coordinates.
fn capture_virtual_screen_at(point: POINT) -> Result<SnapshotFrame, String> {
    let x = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let y = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    let width = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) };
    let height = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) };
    if width < 2 || height < 2 { return Err("Couldn't capture the pointed-at screen.".into()); }
    let mut pixels = blit(x, y, width, height)?;
    mark_cursor(&mut pixels, point.x - x, point.y - y, width, height);
    Ok(SnapshotFrame { source: "screen", source_app: None, width: pixels.width,
        height: pixels.height, rgba: encode_base64(&pixels.rgba) })
}

struct Pixels {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

/// A high-contrast ring and crosshair remains legible after JPEG downscaling.
fn mark_cursor(pixels: &mut Pixels, logical_x: i32, logical_y: i32, source_w: i32, source_h: i32) {
    if source_w <= 0 || source_h <= 0 || logical_x < 0 || logical_y < 0
        || logical_x >= source_w || logical_y >= source_h { return; }
    let cx = (logical_x as f64 * pixels.width as f64 / source_w as f64).round() as i32;
    let cy = (logical_y as f64 * pixels.height as f64 / source_h as f64).round() as i32;
    for dy in -14i32..=14 {
        for dx in -14i32..=14 {
            let x = cx + dx;
            let y = cy + dy;
            if x < 0 || y < 0 || x >= pixels.width as i32 || y >= pixels.height as i32 { continue; }
            let dist2 = dx * dx + dy * dy;
            let ring = (75..=125).contains(&dist2);
            let cross = (dx == 0 && dy.abs() <= 14) || (dy == 0 && dx.abs() <= 14);
            if !ring && !cross { continue; }
            let index = ((y as u32 * pixels.width + x as u32) * 4) as usize;
            pixels.rgba[index..index + 4].copy_from_slice(&[255, 224, 0, 255]);
        }
    }
}


fn blit(x: i32, y: i32, width: i32, height: i32) -> Result<Pixels, String> {
    let (dst_w, dst_h) = fit_edge(width, height);
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return Err("Couldn't capture the screen.".into());
        }
        let memory = CreateCompatibleDC(Some(screen));
        if memory.is_invalid() {
            let _ = ReleaseDC(None, screen);
            return Err("Couldn't capture the screen.".into());
        }
        let bitmap = CreateCompatibleBitmap(screen, dst_w, dst_h);
        if bitmap.is_invalid() {
            let _ = DeleteDC(memory);
            let _ = ReleaseDC(None, screen);
            return Err("Couldn't capture the screen.".into());
        }
        let previous = SelectObject(memory, bitmap.into());
        let copied = if width == dst_w && height == dst_h {
            BitBlt(memory, 0, 0, dst_w, dst_h, Some(screen), x, y, SRCCOPY).is_ok()
        } else {
            StretchBlt(memory, 0, 0, dst_w, dst_h, Some(screen), x, y, width, height, SRCCOPY).as_bool()
        };
        let mut pixels = vec![0u8; (dst_w as usize) * (dst_h as usize) * 4];
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: dst_w,
                biHeight: -dst_h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [Default::default()],
        };
        let rows = if copied {
            GetDIBits(
                memory,
                bitmap,
                0,
                dst_h as u32,
                Some(pixels.as_mut_ptr().cast()),
                &mut info,
                DIB_RGB_COLORS,
            )
        } else {
            0
        };
        let _ = SelectObject(memory, previous);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(memory);
        let _ = ReleaseDC(None, screen);
        if rows == 0 {
            return Err("Couldn't capture the screen.".into());
        }
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            pixel[3] = 255;
        }
        Ok(Pixels { width: dst_w as u32, height: dst_h as u32, rgba: pixels })
    }
}

fn fit_edge(width: i32, height: i32) -> (i32, i32) {
    let long = width.max(height);
    if long <= MAX_EDGE {
        return (width.max(1), height.max(1));
    }
    let scale = MAX_EDGE as f64 / long as f64;
    (
        ((width as f64) * scale).round().max(1.0) as i32,
        ((height as f64) * scale).round().max(1.0) as i32,
    )
}

fn is_our_process(hwnd: HWND) -> bool {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid != 0 && pid == unsafe { GetCurrentProcessId() }
}

fn window_title(hwnd: HWND) -> Option<String> {
    let mut buffer = [0u16; 256];
    let length = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    if length <= 0 {
        return None;
    }
    let title = String::from_utf16_lossy(&buffer[..length as usize]).trim().to_string();
    if title.is_empty() { None } else { Some(title) }
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    let mut index = 0;
    while index + 3 <= bytes.len() {
        let chunk = ((bytes[index] as u32) << 16) | ((bytes[index + 1] as u32) << 8) | bytes[index + 2] as u32;
        out.push(TABLE[((chunk >> 18) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 12) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 6) & 63) as usize] as char);
        out.push(TABLE[(chunk & 63) as usize] as char);
        index += 3;
    }
    let rest = bytes.len() - index;
    if rest == 1 {
        let chunk = (bytes[index] as u32) << 16;
        out.push(TABLE[((chunk >> 18) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 12) & 63) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rest == 2 {
        let chunk = ((bytes[index] as u32) << 16) | ((bytes[index + 1] as u32) << 8);
        out.push(TABLE[((chunk >> 18) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 12) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 6) & 63) as usize] as char);
        out.push('=');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{encode_base64, fit_edge, mark_cursor, Pixels};

    #[test]
    fn fit_keeps_small_frames_and_shrinks_the_long_edge() {
        assert_eq!(fit_edge(100, 50), (100, 50));
        assert_eq!(fit_edge(3200, 1600), (1600, 800));
    }

    #[test]
    fn cursor_marker_is_inside_resized_frame() {
        let mut pixels = Pixels { width: 100, height: 50, rgba: vec![0; 100 * 50 * 4] };
        mark_cursor(&mut pixels, 400, 200, 800, 400);
        let center = ((25 * 100 + 50) * 4) as usize;
        assert_eq!(&pixels.rgba[center..center + 4], &[255, 224, 0, 255]);
        mark_cursor(&mut pixels, -20, 5, 800, 400);
    }

    #[test]
    fn base64_stays_in_memory() {
        assert_eq!(encode_base64(&[0xff, 0xd8, 0xff]), "/9j/");
    }
}
