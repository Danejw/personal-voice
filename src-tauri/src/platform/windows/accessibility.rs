//! On-demand, read-only inspection of a bounded UI Automation subtree.
//! No screenshot, input simulation, background collection, or persistence.
use serde::Serialize;
use windows::core::Interface;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationInvokePattern, IUIAutomationTextPattern,
    IUIAutomationValuePattern, UIA_InvokePatternId, UIA_TextPatternId, UIA_ValuePatternId,
};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};

const MAX_TEXT: i32 = 4096;
const MAX_ELEMENTS: usize = 160;
const MAX_DEPTH: usize = 7;
const MAX_NAME: usize = 280;

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

fn clip(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn extract(element: &IUIAutomationElement) -> Option<String> {
    if unsafe { element.CurrentIsPassword() }.map(|value| value.as_bool()).unwrap_or(true) {
        return None;
    }
    let text = unsafe { element.GetCurrentPattern(UIA_TextPatternId) }
        .ok()
        .and_then(|p| p.cast::<IUIAutomationTextPattern>().ok())
        .and_then(|p| unsafe { p.DocumentRange() }.ok())
        .and_then(|r| unsafe { r.GetText(MAX_TEXT) }.ok())
        .map(|v| v.to_string())
        .filter(|v| !v.trim().is_empty());
    if text.is_some() { return text; }
    let value = unsafe { element.GetCurrentPattern(UIA_ValuePatternId) }
        .ok()
        .and_then(|p| p.cast::<IUIAutomationValuePattern>().ok())
        .and_then(|p| unsafe { p.CurrentValue() }.ok())
        .map(|v| v.to_string())
        .filter(|v| !v.trim().is_empty());
    value.or_else(|| unsafe { element.CurrentName() }.ok()
        .map(|v| clip(&v.to_string(), MAX_NAME))
        .filter(|v| !v.trim().is_empty()))
}

/// Only invoked explicitly by the user. Never descends into password controls.
pub fn inspect_accessibility() -> Result<AccessibilityContext, String> {
    let title = window_title();
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
        .ok().map_err(|e| format!("Accessibility initialization failed: {e}"))?;
    let result = (|| -> Result<AccessibilityContext, String> {
        let automation: IUIAutomation = unsafe {
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
        }.map_err(|e| format!("UI Automation unavailable: {e}"))?;
        let focused = unsafe { automation.GetFocusedElement() }
            .map_err(|e| format!("Cannot inspect focused element: {e}"))?;
        if unsafe { focused.CurrentIsPassword() }.map(|v| v.as_bool()).unwrap_or(true) {
            return Ok(AccessibilityContext { window_title: title, focused_name: None,
                focused_class: None, text: None, status: "protected" });
        }
        let focused_name = unsafe { focused.CurrentName() }.ok().map(|v| clip(&v.to_string(), MAX_NAME));
        let focused_class = unsafe { focused.CurrentClassName() }.ok().map(|v| clip(&v.to_string(), MAX_NAME));
        let walker = unsafe { automation.ControlViewWalker() }
            .map_err(|e| format!("Cannot inspect accessibility tree: {e}"))?;
        let mut pending = vec![(focused, 0usize)];
        let mut parts: Vec<String> = Vec::new();
        let mut used = 0usize;
        let mut visited = 0usize;
        while let Some((element, depth)) = pending.pop() {
            if visited >= MAX_ELEMENTS || used >= MAX_TEXT as usize { break; }
            visited += 1;
            if unsafe { element.CurrentIsPassword() }.map(|v| v.as_bool()).unwrap_or(true) {
                continue;
            }
            if let Some(fragment) = extract(&element) {
                let fragment = fragment.trim();
                if !fragment.is_empty() && !parts.iter().any(|p| p == fragment) {
                    let clipped = clip(fragment, (MAX_TEXT as usize).saturating_sub(used));
                    used += clipped.chars().count() + 1;
                    parts.push(clipped);
                }
            }
            if depth >= MAX_DEPTH { continue; }
            // Collect siblings before pushing in reverse so traversal remains in visual order.
            let mut children = Vec::new();
            if let Ok(mut child) = unsafe { walker.GetFirstChildElement(&element) } {
                for _ in 0..MAX_ELEMENTS {
                    let next = unsafe { walker.GetNextSiblingElement(&child) }.ok();
                    children.push(child);
                    match next { Some(sibling) => child = sibling, None => break }
                }
            }
            for child in children.into_iter().rev() {
                pending.push((child, depth + 1));
            }
        }
        let text = if parts.is_empty() { None } else { Some(parts.join("\n")) };
        Ok(AccessibilityContext {
            window_title: title, focused_name, focused_class,
            status: if text.is_some() { "text-available" } else { "metadata-only" },
            text,
        })
    })();
    unsafe { CoUninitialize() };
    result
}

/** Invoke the currently focused accessible control, only when its name matches.
 * This cannot click arbitrary coordinates, type into a field, or call a shell.
 */
pub fn invoke_focused_control(expected_name: &str) -> Result<String, String> {
    if expected_name.trim().is_empty() || expected_name.chars().count() > 280 {
        return Err("Provide the exact focused control name.".into());
    }
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
        .ok().map_err(|e| format!("Accessibility initialization failed: {e}"))?;
    let result = (|| -> Result<String, String> {
        let automation: IUIAutomation = unsafe {
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
        }.map_err(|e| format!("UI Automation unavailable: {e}"))?;
        let element = unsafe { automation.GetFocusedElement() }
            .map_err(|e| format!("No focused accessibility element: {e}"))?;
        if unsafe { element.CurrentIsPassword() }.map(|v| v.as_bool()).unwrap_or(true) {
            return Err("Protected controls cannot be invoked.".into());
        }
        let name = unsafe { element.CurrentName() }
            .map_err(|e| format!("Control name unavailable: {e}"))?.to_string();
        if name != expected_name {
            return Err(format!("Focus changed. Expected '{expected_name}', found '{name}'."));
        }
        let pattern = unsafe { element.GetCurrentPattern(UIA_InvokePatternId) }
            .map_err(|_| "Focused control does not support InvokePattern.".to_string())?
            .cast::<IUIAutomationInvokePattern>()
            .map_err(|e| format!("Cannot invoke control: {e}"))?;
        unsafe { pattern.Invoke() }.map_err(|e| format!("Invocation failed: {e}"))?;
        Ok(format!("Invoked accessible control '{name}'."))
    })();
    unsafe { CoUninitialize() };
    result
}
