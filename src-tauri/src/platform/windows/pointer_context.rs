//! Read-only mouse context, sampled only while Assistant is active.
//! Cursor coordinates are not persisted. UI Automation is used only for an explicit tool call.
use serde::Serialize;
use windows::core::Interface;
use windows::Win32::Foundation::POINT;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern,
    IUIAutomationValuePattern, UIA_TextPatternId, UIA_ValuePatternId,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetCursorPos, GetWindowTextW, WindowFromPoint, GA_ROOT,
};
use super::accessibility::UiBounds;

const MAX_LABEL: usize = 280;
const MAX_VALUE: usize = 640;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointerPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointerContext {
    pub position: PointerPosition,
    pub window_title: Option<String>,
    pub name: Option<String>,
    pub control_type: Option<i32>,
    pub class_name: Option<String>,
    pub help_text: Option<String>,
    pub value: Option<String>,
    pub selected_text: Option<String>,
    pub bounds: Option<UiBounds>,
    pub status: &'static str,
}

fn clip(value: String, limit: usize) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.chars().take(limit).collect())
}

fn bounds(element: &IUIAutomationElement) -> Option<UiBounds> {
    let r = unsafe { element.CurrentBoundingRectangle() }.ok()?;
    let width = r.right - r.left;
    let height = r.bottom - r.top;
    (width > 0 && height > 0 && width < 30_000 && height < 30_000)
        .then_some(UiBounds { x: r.left, y: r.top, width, height })
}

/// Cheap read of virtual-desktop physical pixel coordinates, including negative positions.
pub fn pointer_position() -> Result<PointerPosition, String> {
    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point) }.map_err(|e| format!("Cannot read mouse position: {e}"))?;
    Ok(PointerPosition { x: point.x, y: point.y })
}

fn hovered_window_title(point: POINT) -> Option<String> {
    let hwnd = unsafe { WindowFromPoint(point) };
    if hwnd.0.is_null() { return None; }
    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
    let hwnd = if root.0.is_null() { hwnd } else { root };
    let mut buffer = [0u16; 256];
    let length = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    (length > 0).then(|| String::from_utf16_lossy(&buffer[..length.max(0) as usize]))
        .and_then(|value| clip(value, MAX_LABEL))
}

/// One synchronous, on-demand hit test at the current pointer position.
/// Never clicks, takes screenshots, reads passwords, or collects background text.
pub fn inspect_pointer_context() -> Result<PointerContext, String> {
    let position = pointer_position()?;
    let point = POINT { x: position.x, y: position.y };
    let title = hovered_window_title(point);
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
        .ok().map_err(|e| format!("Cannot initialize accessibility inspection: {e}"))?;
    let result = (|| -> Result<PointerContext, String> {
        let automation: IUIAutomation = unsafe {
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
        }.map_err(|e| format!("UI Automation unavailable: {e}"))?;
        let element = match unsafe { automation.ElementFromPoint(point) } {
            Ok(element) => element,
            Err(_) => return Ok(PointerContext {
                position, window_title: title, name: None, control_type: None,
                class_name: None, help_text: None, value: None, selected_text: None,
                bounds: None, status: "position-only",
            }),
        };
        let protected = unsafe { element.CurrentIsPassword() }
            .map(|value| value.as_bool()).unwrap_or(true);
        if protected {
            return Ok(PointerContext {
                position, window_title: title, name: None, control_type: None,
                class_name: None, help_text: None, value: None, selected_text: None,
                bounds: None, status: "protected",
            });
        }
        let get = |value: windows::core::Result<windows::core::BSTR>, limit: usize| {
            value.ok().and_then(|value| clip(value.to_string(), limit))
        };
        let name = get(unsafe { element.CurrentName() }, MAX_LABEL);
        let class_name = get(unsafe { element.CurrentClassName() }, MAX_LABEL);
        let help_text = get(unsafe { element.CurrentHelpText() }, MAX_LABEL);
        let control_type = unsafe { element.CurrentControlType() }.ok().map(|v| v.0);
        let value = unsafe { element.GetCurrentPattern(UIA_ValuePatternId) }
            .ok().and_then(|p| p.cast::<IUIAutomationValuePattern>().ok())
            .and_then(|p| unsafe { p.CurrentValue() }.ok())
            .and_then(|v| clip(v.to_string(), MAX_VALUE));
        let selected_text = unsafe { element.GetCurrentPattern(UIA_TextPatternId) }
            .ok().and_then(|p| p.cast::<IUIAutomationTextPattern>().ok())
            .and_then(|p| unsafe { p.GetSelection() }.ok())
            .and_then(|ranges| unsafe { ranges.GetElement(0) }.ok())
            .and_then(|range| unsafe { range.GetText(MAX_VALUE as i32) }.ok())
            .and_then(|v| clip(v.to_string(), MAX_VALUE));
        let bounds = bounds(&element);
        let status = if selected_text.is_some() { "selection-available" }
            else if name.is_some() || value.is_some() { "element-available" }
            else { "position-only" };
        Ok(PointerContext {
            position, window_title: title, name, control_type, class_name, help_text,
            value, selected_text, bounds, status,
        })
    })();
    unsafe { CoUninitialize() };
    result
}

#[cfg(test)]
mod tests {
    use super::clip;
    #[test]
    fn clips_hovered_text_before_sharing_it() {
        assert_eq!(clip("  example  ".into(), 4), Some("exam".into()));
        assert_eq!(clip("  ".into(), 10), None);
    }
}
