//! User-triggered, read-only Windows UI Automation inspection.
//! No keyboard hooks, screenshots, polling, persistence, or remote actions.
use serde::Serialize;
use windows::core::Interface;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationTextPattern, UIA_TextPatternId,
};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};

const MAX_TEXT: i32 = 4096;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessibilityContext {
    pub window_title: Option<String>,
    pub focused_name: Option<String>,
    pub focused_class: Option<String>,
    pub text: Option<String>,
    pub status: &'static str,
}

fn window_title() -> Option<String> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() { return None; }
    let mut buf = [0u16; 256];
    let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
    (len > 0).then(|| String::from_utf16_lossy(&buf[..len.max(0) as usize]))
}

/// Only called after the user presses Inspect. Password fields are never read.
pub fn inspect_accessibility() -> Result<AccessibilityContext, String> {
    let title = window_title();
    // UIA's COM apartment is local to the blocking worker thread.
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
        .map_err(|e| format!("Accessibility initialization failed: {e}"))?;
    let result = (|| -> Result<AccessibilityContext, String> {
        let automation: IUIAutomation = unsafe {
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
        }.map_err(|e| format!("UI Automation unavailable: {e}"))?;
        let focused = unsafe { automation.GetFocusedElement() }
            .map_err(|e| format!("Cannot inspect focused element: {e}"))?;
        if unsafe { focused.CurrentIsPassword() }.unwrap_or_default().as_bool() {
            return Ok(AccessibilityContext {
                window_title: title,
                focused_name: None,
                focused_class: None,
                text: None,
                status: "protected",
            });
        }
        let focused_name = unsafe { focused.CurrentName() }.ok().map(|v| v.to_string());
        let focused_class = unsafe { focused.CurrentClassName() }.ok().map(|v| v.to_string());
        let text = unsafe { focused.GetCurrentPattern(UIA_TextPatternId) }
            .ok()
            .and_then(|pattern| pattern.cast::<IUIAutomationTextPattern>().ok())
            .and_then(|pattern| unsafe { pattern.DocumentRange() }.ok())
            .and_then(|range| unsafe { range.GetText(MAX_TEXT) }.ok())
            .map(|value| value.to_string())
            .filter(|value| !value.is_empty());
        Ok(AccessibilityContext {
            window_title: title,
            focused_name,
            focused_class,
            status: if text.is_some() { "text-available" } else { "metadata-only" },
            text,
        })
    })();
    unsafe { CoUninitialize() };
    result
}
