//! Structured Windows UI Automation inspection and capability-based actions.
//! Calls operate in a worker COM apartment. Structural locators expire when the UI changes;
//! every action checks the active window, automation ID, control type and accessible name.
use serde::{Deserialize, Serialize};
use windows::core::{BSTR, Interface};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTreeWalker,
    IUIAutomationTogglePattern, IUIAutomationRangeValuePattern, IUIAutomationScrollItemPattern,
    IUIAutomationSelectionItemPattern, IUIAutomationExpandCollapsePattern, IUIAutomationInvokePattern,
    IUIAutomationValuePattern, IUIAutomationTextPattern, IUIAutomationGridPattern,
    IUIAutomationVirtualizedItemPattern, IUIAutomationWindowPattern, IUIAutomationTransformPattern,
    UIA_TogglePatternId, UIA_RangeValuePatternId, UIA_ScrollItemPatternId,
    UIA_SelectionItemPatternId, UIA_ExpandCollapsePatternId, UIA_InvokePatternId,
    UIA_ValuePatternId, UIA_TextPatternId, UIA_GridPatternId, UIA_GridItemPatternId,
    UIA_TablePatternId, UIA_VirtualizedItemPatternId, UIA_WindowPatternId,
    UIA_TransformPatternId, UIA_SelectionPatternId, WindowVisualState,
};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
use super::accessibility::{foreground_bounds, UiBounds};
use super::windows_info::foreground_window_title;

const LIMIT: usize = 240;
const DEPTH_LIMIT: usize = 9;
const STRING_LIMIT: usize = 320;

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ControlNode {
    pub path: String,
    pub parent: Option<String>,
    pub name: String,
    pub automation_id: String,
    pub control_type: i32,
    pub class_name: String,
    pub framework: String,
    pub enabled: bool,
    pub offscreen: bool,
    pub focused: bool,
    pub bounds: Option<UiBounds>,
    pub patterns: Vec<&'static str>,
    pub value: Option<String>,
    pub selection: Option<String>,
    pub grid: Option<GridInfo>,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct GridInfo { pub rows: i32, pub columns: i32 }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct TreeReport { pub window_title: String, pub nodes: Vec<ControlNode>, pub truncated: bool }
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Locator {
    pub window: String,
    pub path: String,
    pub name: String,
    pub automation_id: String,
    pub control_type: i32,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ActionResult { pub message: String, pub bounds: Option<UiBounds>, pub observed: Option<String> }

fn clip(value: &str, count: usize) -> String { value.chars().take(count).collect() }
fn pattern<T: Interface>(element: &IUIAutomationElement, id: windows::Win32::UI::Accessibility::UIA_PATTERN_ID) -> Option<T> {
    unsafe { element.GetCurrentPattern(id) }.ok()?.cast().ok()
}
fn rect(element: &IUIAutomationElement) -> Option<UiBounds> {
    let r = unsafe { element.CurrentBoundingRectangle() }.ok()?;
    let width = r.right-r.left;
    let height = r.bottom-r.top;
    (width > 0 && height > 0 && width <= 30000 && height <= 30000)
        .then_some(UiBounds { x:r.left,y:r.top,width,height })
}
fn metadata(element: &IUIAutomationElement, path: String, parent: Option<String>) -> ControlNode {
    let get = |value: Option<String>| clip(value.as_deref().unwrap_or(""), STRING_LIMIT);
    let name = get(unsafe {element.CurrentName()}.ok().map(|x| x.to_string()));
    let automation_id = get(unsafe {element.CurrentAutomationId()}.ok().map(|x| x.to_string()));
    let class_name = get(unsafe {element.CurrentClassName()}.ok().map(|x| x.to_string()));
    let framework = get(unsafe {element.CurrentFrameworkId()}.ok().map(|x| x.to_string()));
    let control_type = unsafe {element.CurrentControlType()}.map(|x|x.0).unwrap_or_default();
    let enabled = unsafe {element.CurrentIsEnabled()}.map(|x|x.as_bool()).unwrap_or(false);
    let offscreen = unsafe {element.CurrentIsOffscreen()}.map(|x|x.as_bool()).unwrap_or(true);
    let focused = unsafe {element.CurrentHasKeyboardFocus()}.map(|x|x.as_bool()).unwrap_or(false);
    let ids = [
        ("invoke",UIA_InvokePatternId),("toggle",UIA_TogglePatternId),
        ("range",UIA_RangeValuePatternId),("scroll-item",UIA_ScrollItemPatternId),
        ("select-item",UIA_SelectionItemPatternId),("expand",UIA_ExpandCollapsePatternId),
        ("value",UIA_ValuePatternId),("text",UIA_TextPatternId),
        ("grid",UIA_GridPatternId),("grid-item",UIA_GridItemPatternId),
        ("table",UIA_TablePatternId),("virtualized",UIA_VirtualizedItemPatternId),
        ("window",UIA_WindowPatternId),("transform",UIA_TransformPatternId),
        ("selection-container",UIA_SelectionPatternId),
    ];
    let patterns = ids.iter().filter_map(|(name,id)| unsafe {element.GetCurrentPattern(*id)}.ok().map(|_|*name)).collect();
    let is_password = unsafe {element.CurrentIsPassword()}.map(|v|v.as_bool()).unwrap_or(true);
    let value = if is_password {None} else {
        pattern::<IUIAutomationValuePattern>(element,UIA_ValuePatternId)
          .and_then(|p|unsafe{p.CurrentValue()}.ok())
          .map(|v|clip(&v.to_string(),1200))
    };
    let selection = if is_password {None} else {
        pattern::<IUIAutomationTextPattern>(element,UIA_TextPatternId)
          .and_then(|p|unsafe{p.GetSelection()}.ok())
          .and_then(|a|unsafe{a.GetElement(0)}.ok())
          .and_then(|r|unsafe{r.GetText(1200)}.ok())
          .map(|t|t.to_string()).filter(|s|!s.is_empty())
    };
    let grid = pattern::<IUIAutomationGridPattern>(element, UIA_GridPatternId)
      .and_then(|p| Some(GridInfo {rows:unsafe{p.CurrentRowCount()}.ok()?, columns:unsafe{p.CurrentColumnCount()}.ok()?}));
    ControlNode {path,parent,name,automation_id,control_type,class_name,framework,
       enabled,offscreen,focused,bounds:rect(element),patterns,value,selection,grid}
}
fn with_automation<T>(f: impl FnOnce(&IUIAutomation)->Result<T,String>) -> Result<T,String> {
    unsafe {CoInitializeEx(None,COINIT_APARTMENTTHREADED)}.ok()
      .map_err(|e|format!("COM apartment failed: {e}"))?;
    let result = (|| {
      let automation: IUIAutomation = unsafe{CoCreateInstance(&CUIAutomation,None,CLSCTX_INPROC_SERVER)}
        .map_err(|e|format!("UI Automation unavailable: {e}"))?;
      f(&automation)
    })();
    unsafe{CoUninitialize()};
    result
}
fn context(automation: &IUIAutomation) -> Result<(String,IUIAutomationElement,IUIAutomationTreeWalker),String> {
    let title = foreground_window_title().ok_or("No active window")?;
    let hwnd = unsafe{GetForegroundWindow()};
    if hwnd.0.is_null() {return Err("No active window handle".into());}
    let root = unsafe{automation.ElementFromHandle(hwnd)}.map_err(|e|e.to_string())?;
    let walker = unsafe{automation.ControlViewWalker()}.map_err(|e|e.to_string())?;
    Ok((title,root,walker))
}
fn children(parent:&IUIAutomationElement, walker:&IUIAutomationTreeWalker) -> Vec<IUIAutomationElement> {
    let mut output = Vec::new();
    if let Ok(mut child) = unsafe{walker.GetFirstChildElement(parent)} {
        for _ in 0..LIMIT {
            let next = unsafe{walker.GetNextSiblingElement(&child)}.ok();
            output.push(child);
            match next {Some(s)=>child=s,None=>break}
        }
    }
    output
}
pub fn inspect_tree() -> Result<TreeReport,String> {
    with_automation(|automation| {
        let (title,root,walker) = context(automation)?;
        let mut pending = vec![(root,String::from("0"),None,0usize)];
        let mut nodes = Vec::new();
        let mut truncated = false;
        while let Some((element,path,parent,depth))=pending.pop(){
            if nodes.len()>=LIMIT {truncated=true;break;}
            if unsafe{element.CurrentIsPassword()}.map(|x|x.as_bool()).unwrap_or(true){continue;}
            nodes.push(metadata(&element,path.clone(),parent));
            if depth<DEPTH_LIMIT {
                for (index,child) in children(&element,&walker).into_iter().enumerate().rev(){
                    pending.push((child,format!("{path}.{index}"),Some(path.clone()),depth+1));
                }
            }
        }
        Ok(TreeReport{window_title:title,nodes,truncated})
    })
}
fn resolve(root:IUIAutomationElement, walker:&IUIAutomationTreeWalker, path:&str)->Result<IUIAutomationElement,String>{
    let parts:Vec<&str>=path.split('.').collect();
    if parts.is_empty()||parts.len()>DEPTH_LIMIT+1||parts[0]!="0"{return Err("Invalid element locator".into());}
    let mut element=root;
    for part in &parts[1..] {
        let index:usize=part.parse().map_err(|_|"Invalid path index")?;
        if index>=LIMIT{return Err("Element index out of range".into());}
        element=children(&element,walker).into_iter().nth(index)
          .ok_or("Element moved or was removed; re-inspect")?;
    }
    Ok(element)
}
pub fn action(loc: Locator, command:&str, text:Option<&str>, number:Option<f64>)->Result<ActionResult,String>{
    if loc.window.is_empty()||loc.window.chars().count()>240||loc.path.len()>90
      ||loc.name.chars().count()>STRING_LIMIT||loc.automation_id.chars().count()>STRING_LIMIT {
      return Err("Invalid accessibility locator".into());
    }
    let allowed=["focus","invoke","toggle","select","add-selection","remove-selection",
        "expand","collapse","scroll-into-view","realize","set-value","set-range",
        "minimize","maximize","restore","move","resize"];
    if !allowed.contains(&command){return Err("Unsupported operation".into());}
    with_automation(|automation|{
        let (window,root,walker)=context(automation)?;
        if window != loc.window {return Err("Active window changed; inspect again".into());}
        let element=resolve(root,&walker,&loc.path)?;
        if unsafe{element.CurrentIsPassword()}.map(|x|x.as_bool()).unwrap_or(true){
            return Err("Protected control is unavailable".into());
        }
        let found=metadata(&element,loc.path.clone(),None);
        if found.control_type!=loc.control_type || found.name!=loc.name || found.automation_id!=loc.automation_id {
            return Err("Element changed since inspection; re-inspect before acting".into());
        }
        if !found.enabled {return Err("Control is disabled".into());}
        let supported = |id| unsafe{element.GetCurrentPattern(id)}
            .map_err(|_|"The app does not support this accessibility control".to_string());
        let mut observed=None;
        match command {
            "focus"=>unsafe{element.SetFocus()}.map_err(|e|e.to_string())?,
            "invoke"=>{
                let p=supported(UIA_InvokePatternId)?.cast::<IUIAutomationInvokePattern>().map_err(|e|e.to_string())?;
                unsafe{p.Invoke()}.map_err(|e|e.to_string())?;
            }
            "toggle"=>{
                let p=supported(UIA_TogglePatternId)?.cast::<IUIAutomationTogglePattern>().map_err(|e|e.to_string())?;
                unsafe{p.Toggle()}.map_err(|e|e.to_string())?;
                observed=unsafe{p.CurrentToggleState()}.ok().map(|s|format!("Toggle state: {}",s.0));
            }
            "select"|"add-selection"|"remove-selection"=>{
                let p=supported(UIA_SelectionItemPatternId)?.cast::<IUIAutomationSelectionItemPattern>().map_err(|e|e.to_string())?;
                match command {
                    "select"=>unsafe{p.Select()},
                    "add-selection"=>unsafe{p.AddToSelection()},
                    _=>unsafe{p.RemoveFromSelection()}
                }.map_err(|e|e.to_string())?;
            }
            "expand"|"collapse"=>{
                let p=supported(UIA_ExpandCollapsePatternId)?.cast::<IUIAutomationExpandCollapsePattern>().map_err(|e|e.to_string())?;
                if command=="expand" {unsafe{p.Expand()}} else {unsafe{p.Collapse()}}.map_err(|e|e.to_string())?;
            }
            "scroll-into-view"=>{
                let p=supported(UIA_ScrollItemPatternId)?.cast::<IUIAutomationScrollItemPattern>().map_err(|e|e.to_string())?;
                unsafe{p.ScrollIntoView()}.map_err(|e|e.to_string())?;
            }
            "realize"=>{
                let p=supported(UIA_VirtualizedItemPatternId)?.cast::<IUIAutomationVirtualizedItemPattern>().map_err(|e|e.to_string())?;
                unsafe{p.Realize()}.map_err(|e|e.to_string())?;
            }
            "set-value"=>{
                let value=text.ok_or("Missing text value")?;
                if value.chars().count()>1500 {return Err("Text too long (1500 characters maximum)".into());}
                let p=supported(UIA_ValuePatternId)?.cast::<IUIAutomationValuePattern>().map_err(|e|e.to_string())?;
                if unsafe{p.CurrentIsReadOnly()}.map(|x|x.as_bool()).unwrap_or(true) {return Err("Read-only field".into());}
                unsafe{p.SetValue(&BSTR::from(value))}.map_err(|e|e.to_string())?;
            }
            "set-range"=>{
                let v=number.filter(|n|n.is_finite()).ok_or("Provide a finite numeric value")?;
                let p=supported(UIA_RangeValuePatternId)?.cast::<IUIAutomationRangeValuePattern>().map_err(|e|e.to_string())?;
                if unsafe{p.CurrentIsReadOnly()}.map(|x|x.as_bool()).unwrap_or(true){return Err("Read-only range".into());}
                let low=unsafe{p.CurrentMinimum()}.map_err(|e|e.to_string())?;
                let high=unsafe{p.CurrentMaximum()}.map_err(|e|e.to_string())?;
                if v<low||v>high{return Err(format!("Value outside supported range {low}–{high}"));}
                unsafe{p.SetValue(v)}.map_err(|e|e.to_string())?;
                observed=unsafe{p.CurrentValue()}.ok().map(|x|format!("Range value: {x}"));
            }
            "minimize"|"maximize"|"restore"=>{
                let p=supported(UIA_WindowPatternId)?.cast::<IUIAutomationWindowPattern>().map_err(|e|e.to_string())?;
                let value=match command {"minimize"=>1,"maximize"=>2,_=>0};
                unsafe{p.SetWindowVisualState(WindowVisualState(value))}.map_err(|e|e.to_string())?;
            }
            "move"|"resize"=>{
                // Deliberately restricted to the provided UIA target, not arbitrary coordinates.
                let p=supported(UIA_TransformPatternId)?.cast::<IUIAutomationTransformPattern>().map_err(|e|e.to_string())?;
                let coords=text.ok_or("Expected 'x,y' or 'width,height'")?;
                let values:Vec<f64>=coords.split(',').map(str::trim).map(str::parse::<f64>).collect::<Result<_,_>>()
                  .map_err(|_|"Two numbers required, separated by a comma")?;
                if values.len()!=2||values.iter().any(|x|!x.is_finite()||x.abs()>20000.0){
                    return Err("Invalid bounds".into());
                }
                if command=="move" {
                    unsafe{p.Move(values[0],values[1])}
                } else {
                    if values[0]<80.0||values[1]<60.0{return Err("Resize dimensions too small".into());}
                    unsafe{p.Resize(values[0],values[1])}
                }.map_err(|e|e.to_string())?;
            }
            _=>unreachable!(),
        }
        Ok(ActionResult{message:format!("{command} executed on '{}'",loc.name),
            bounds:rect(&element).or_else(foreground_bounds),observed})
    })
}
