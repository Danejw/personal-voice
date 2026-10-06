//! Conservative in-place transcript preview through Windows UI Automation.
//!
//! Never simulates Backspace, Ctrl+A, Ctrl+Z, or clipboard edits. This deliberately
//! supports only empty, non-password, writable UIA Edit fields with ValuePattern.
//! Other inputs fall back to the existing one-shot paste after final transcription.

use std::sync::{mpsc, OnceLock};
use windows::core::BSTR;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationValuePattern,
    UIA_EditControlTypeId, UIA_ValuePatternId,
};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

struct Request {
    phase: String,
    text: String,
    reply: mpsc::Sender<bool>,
}

struct Session {
    element: IUIAutomationElement,
    window: windows::Win32::Foundation::HWND,
    last: String,
}

static WORKER: OnceLock<mpsc::Sender<Request>> = OnceLock::new();

pub fn live_dictation_text(phase: &str, text: &str) -> bool {
    let sender = WORKER.get_or_init(|| {
        let (sender, receiver) = mpsc::channel::<Request>();
        std::thread::Builder::new()
            .name("live-dictation-uia".into())
            .spawn(move || run(receiver))
            .expect("Could not start the live dictation worker");
        sender
    });
    let (reply, answer) = mpsc::channel();
    if sender.send(Request { phase: phase.into(), text: text.into(), reply }).is_err() {
        return false;
    }
    // Wait for this edit before issuing a later edit or the final insertion. The
    // caller runs on a blocking pool thread and must not guess after a timeout.
    answer.recv().unwrap_or(false)
}

fn run(receiver: mpsc::Receiver<Request>) {
    if unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_err() {
        for request in receiver {
            let _ = request.reply.send(false);
        }
        return;
    }
    let automation: Option<IUIAutomation> =
        unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }.ok();
    let mut session: Option<Session> = None;
    for request in receiver {
        let success = automation.as_ref().is_some_and(|automation| {
            apply(automation, &mut session, &request.phase, &request.text)
        });
        let _ = request.reply.send(success);
    }
    drop(session);
    drop(automation);
    unsafe { CoUninitialize() };
}

fn focused_edit(automation: &IUIAutomation) -> Option<(IUIAutomationElement, IUIAutomationValuePattern)> {
    let element = unsafe { automation.GetFocusedElement() }.ok()?;
    if unsafe { element.CurrentIsPassword() }.ok()?.as_bool()
        || !unsafe { element.CurrentHasKeyboardFocus() }.ok()?.as_bool()
        || unsafe { element.CurrentControlType() }.ok()? != UIA_EditControlTypeId
    {
        return None;
    }
    let value: IUIAutomationValuePattern =
        unsafe { element.GetCurrentPatternAs(UIA_ValuePatternId) }.ok()?;
    if unsafe { value.CurrentIsReadOnly() }.ok()?.as_bool() {
        return None;
    }
    Some((element, value))
}

fn apply(automation: &IUIAutomation, session: &mut Option<Session>, phase: &str, text: &str) -> bool {
    if phase != "update" && phase != "commit" && phase != "cancel" {
        return false;
    }
    if phase == "cancel" && session.is_none() {
        return false;
    }

    let Some((element, value)) = focused_edit(automation) else {
        *session = None;
        return false;
    };

    if session.is_none() {
        if phase != "update" {
            return false;
        }
        // With an existing value the caret might be in the middle or a selection
        // might be active. Without a verified range, do not replace that content.
        if unsafe { value.CurrentValue() }.ok().map(|v| v.to_string()).as_deref() != Some("") {
            return false;
        }
        let window = unsafe { GetForegroundWindow() };
        if window.is_invalid() {
            return false;
        }
        let result = unsafe { value.SetValue(&BSTR::from(text)) }.is_ok();
        if result {
            *session = Some(Session { element, window, last: text.into() });
        }
        return result;
    }

    let old = session.as_ref().expect("checked");
    let same_field = unsafe { automation.CompareElements(&old.element, &element) }
        .ok().is_some_and(|result| result.as_bool())
        && unsafe { GetForegroundWindow() } == old.window;
    let unchanged = unsafe { value.CurrentValue() }
        .ok().is_some_and(|value| value.to_string() == old.last);
    if !same_field || !unchanged {
        *session = None;
        return false;
    }

    let new_text = if phase == "cancel" { "" } else { text };
    let changed = unsafe { value.SetValue(&BSTR::from(new_text)) }.is_ok();
    if !changed || phase != "update" {
        *session = None;
    } else if let Some(active) = session {
        active.last = text.into();
    }
    changed
}
