//! On-demand, read-only inspection of a bounded UI Automation subtree.
//! No screenshot, input simulation, background collection, or persistence.
use serde::Serialize;
use windows::core::Interface;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationInvokePattern, IUIAutomationTextPattern,
    IUIAutomationValuePattern, IUIAutomationExpandCollapsePattern, IUIAutomationSelectionItemPattern,
    IUIAutomationScrollPattern, UIA_InvokePatternId, UIA_TextPatternId, UIA_ValuePatternId,
    UIA_ExpandCollapsePatternId, UIA_SelectionItemPatternId, UIA_ScrollPatternId, ScrollAmount,
};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};

const MAX_TEXT: i32 = 4096;
const MAX_ELEMENTS: usize = 160;
const MAX_DEPTH: usize = 7;
const MAX_NAME: usize = 280;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessibilityContext {
    pub bounds: Option<UiBounds>,
    pub window_title: Option<String>,
    pub focused_name: Option<String>,
    pub focused_class: Option<String>,
    pub text: Option<String>,
    pub status: &'static str,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiBounds { pub x: i32, pub y: i32, pub width: i32, pub height: i32 }

pub fn foreground_bounds() -> Option<UiBounds> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() { return None; }
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.ok()?;
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    (width > 5 && height > 5).then_some(UiBounds { x: rect.left, y: rect.top, width, height })
}

fn element_bounds(element: &IUIAutomationElement) -> Option<UiBounds> {
    let rect = unsafe { element.CurrentBoundingRectangle() }.ok()?;
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    (width > 5 && height > 5 && width < 30000 && height < 30000).then_some(UiBounds {
        x: rect.left, y: rect.top, width, height
    })
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
            return Ok(AccessibilityContext { bounds: None, window_title: title, focused_name: None,
                focused_class: None, text: None, status: "protected" });
        }
        let bounds = element_bounds(&focused).or_else(foreground_bounds);
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
            bounds, window_title: title, focused_name, focused_class,
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

/** Focus a Windows UI Automation control with a verified exact accessible name.
 * Never attempts to type, invoke or change values.
 */
pub fn focus_accessible_control(expected_name: &str) -> Result<String, String> {
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
            .map_err(|e| format!("No focused element: {e}"))?;
        if unsafe { element.CurrentIsPassword() }.map(|v| v.as_bool()).unwrap_or(true) {
            return Err("Protected controls are unavailable.".into());
        }
        let name = unsafe { element.CurrentName() }
            .map_err(|e| format!("Name unavailable: {e}"))?.to_string();
        if name != expected_name { return Err("The focused control changed. Inspect again.".into()); }
        unsafe { element.SetFocus() }.map_err(|e| format!("Cannot focus control: {e}"))?;
        Ok(format!("Focused accessible control '{name}'."))
    })();
    unsafe { CoUninitialize() };
    result
}

/** Single explicit, bounded UI Automation operation on an exact-name focused element.
 * Never traverses password fields or accepts arbitrary process commands.
 */
pub fn control_action(action: &str, expected_name: &str, value: Option<&str>) -> Result<String, String> {
    if expected_name.is_empty() || expected_name.chars().count() > 280 {
        return Err("Provide the exact control name from inspection.".into());
    }
    if !matches!(action, "focus" | "invoke" | "select" | "expand" | "collapse" | "scroll-up" | "scroll-down" | "set-value") {
        return Err("Unsupported accessibility operation.".into());
    }
    if action == "set-value" && value.map(|v| v.chars().count() > 1000).unwrap_or(true) {
        return Err("A value of at most 1000 characters is required.".into());
    }
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
        .ok().map_err(|e| format!("Accessibility initialization failed: {e}"))?;
    let result = (|| -> Result<String, String> {
        let automation: IUIAutomation = unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }
            .map_err(|e| format!("UI Automation unavailable: {e}"))?;
        let element = unsafe { automation.GetFocusedElement() }
            .map_err(|e| format!("Focused control unavailable: {e}"))?;
        if unsafe { element.CurrentIsPassword() }.map(|v| v.as_bool()).unwrap_or(true) {
            return Err("Password or protected controls cannot be accessed.".into());
        }
        let name = unsafe { element.CurrentName() }.map_err(|e| e.to_string())?.to_string();
        if name != expected_name { return Err("Focus changed. Inspect again before acting.".into()); }
        if unsafe { element.CurrentIsEnabled() }.map(|v| !v.as_bool()).unwrap_or(true) {
            return Err("That control is disabled.".into());
        }
        match action {
            "focus" => unsafe { element.SetFocus() }.map_err(|e| e.to_string())?,
            "invoke" => {
                let p = unsafe { element.GetCurrentPattern(UIA_InvokePatternId) }
                    .map_err(|_| "InvokePattern not supported.")?.cast::<IUIAutomationInvokePattern>()
                    .map_err(|e| e.to_string())?;
                unsafe { p.Invoke() }.map_err(|e| e.to_string())?;
            },
            "select" => {
                let p = unsafe { element.GetCurrentPattern(UIA_SelectionItemPatternId) }
                    .map_err(|_| "SelectionItemPattern not supported.")?.cast::<IUIAutomationSelectionItemPattern>()
                    .map_err(|e| e.to_string())?;
                unsafe { p.Select() }.map_err(|e| e.to_string())?;
            },
            "expand" | "collapse" => {
                let p = unsafe { element.GetCurrentPattern(UIA_ExpandCollapsePatternId) }
                    .map_err(|_| "ExpandCollapsePattern not supported.")?.cast::<IUIAutomationExpandCollapsePattern>()
                    .map_err(|e| e.to_string())?;
                if action == "expand" { unsafe { p.Expand() } } else { unsafe { p.Collapse() } }
                    .map_err(|e| e.to_string())?;
            },
            "scroll-up" | "scroll-down" => {
                let p = unsafe { element.GetCurrentPattern(UIA_ScrollPatternId) }
                    .map_err(|_| "ScrollPattern not supported.")?.cast::<IUIAutomationScrollPattern>()
                    .map_err(|e| e.to_string())?;
                let amount = if action == "scroll-down" { ScrollAmount(4) } else { ScrollAmount(1) };
                unsafe { p.Scroll(ScrollAmount(2), amount) }.map_err(|e| e.to_string())?;
            },
            "set-value" => {
                let p = unsafe { element.GetCurrentPattern(UIA_ValuePatternId) }
                    .map_err(|_| "ValuePattern not supported.")?.cast::<IUIAutomationValuePattern>()
                    .map_err(|e| e.to_string())?;
                if unsafe { p.CurrentIsReadOnly() }.map(|v| v.as_bool()).unwrap_or(true) {
                    return Err("The field is read-only.".into());
                }
                let wide: Vec<u16> = value.unwrap_or("").encode_utf16().chain(std::iter::once(0)).collect();
                unsafe { p.SetValue(windows::core::PCWSTR(wide.as_ptr())) }.map_err(|e| e.to_string())?;
            },
            _ => unreachable!(),
        }
        Ok(format!("{action} succeeded on '{name}'."))
    })();
    unsafe { CoUninitialize() };
    result
}
