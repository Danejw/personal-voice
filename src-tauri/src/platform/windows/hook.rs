//! Global low-level keyboard and mouse hooks for push-to-talk. Unlike
//! `RegisterHotKey`, they report button-up and support a lone key such as Right Alt
//! or a mouse side button.

use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};

use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, HC_ACTION,
    KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_MBUTTONDOWN,
    WM_MBUTTONUP, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_SYSKEYDOWN, WM_XBUTTONDOWN, WM_XBUTTONUP,
};

use super::push_to_talk::{
    Modifiers, PttEvent, PushToTalk, Shortcut, VK_MBUTTON, VK_RBUTTON, VK_XBUTTON1, VK_XBUTTON2,
};

/// Marks input this app synthesizes (the paste chord) so the hook ignores it.
pub const SYNTHETIC_INPUT_MARK: usize = 0x5056_4F49;

struct Hook {
    state: Mutex<PushToTalk>,
    events: Sender<PttEvent>,
}

static HOOK: OnceLock<Hook> = OnceLock::new();

/// Installs the hooks on their own message-loop thread; `on_event` runs on another thread.
pub fn start(on_event: impl Fn(PttEvent) + Send + 'static) -> Result<(), String> {
    let (events, receiver) = channel();
    HOOK.set(Hook {
        state: Mutex::new(PushToTalk::default()),
        events,
    })
    .map_err(|_| "Push-to-talk is already running.".to_string())?;
    std::thread::spawn(move || receiver.iter().for_each(on_event));

    let (ready, installed) = channel();
    std::thread::spawn(move || unsafe {
        let module = GetModuleHandleW(None).ok().map(|m| HINSTANCE(m.0));
        match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), module, 0) {
            Ok(_) => {
                let _ = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), module, 0);
                let _ = ready.send(Ok(()));
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
            Err(error) => {
                let _ = ready.send(Err(format!(
                    "Could not install the push-to-talk hook: {error}"
                )));
            }
        }
    });
    installed
        .recv()
        .map_err(|_| "Push-to-talk hook thread exited.".to_string())?
}

pub fn set_shortcut(shortcut: Shortcut) {
    with_state(|state| state.set_shortcut(shortcut));
}

pub fn set_hotkeys(
    dictate: Vec<Shortcut>,
    voice_note: Vec<Shortcut>,
    handoff: Vec<Shortcut>,
    selection: Vec<Shortcut>,
) -> Result<(), String> {
    match HOOK.get() {
        Some(hook) => match hook.state.lock() {
            Ok(mut state) => state.set_hotkeys(dictate, voice_note, handoff, selection),
            Err(_) => Err("Push-to-talk is busy.".into()),
        },
        None => Err("Push-to-talk is not running.".into()),
    }
}

pub fn set_capturing(capturing: bool) -> Result<(), String> {
    match HOOK.get() {
        Some(hook) => match hook.state.lock() {
            Ok(mut state) => {
                state.set_capturing(capturing);
                Ok(())
            }
            Err(_) => Err("Push-to-talk is busy.".into()),
        },
        None => Err("Push-to-talk is not running.".into()),
    }
}

pub fn set_active(active: bool) {
    with_state(|state| state.active = active);
}

pub fn set_paused(paused: bool) {
    with_state(|state| state.set_paused(paused));
}

fn with_state(update: impl FnOnce(&mut PushToTalk)) {
    if let Some(hook) = HOOK.get() {
        if let Ok(mut state) = hook.state.lock() {
            update(&mut state);
        }
    }
}

fn is_down(vk: u16) -> bool {
    unsafe { GetAsyncKeyState(i32::from(vk)) as u16 & 0x8000 != 0 }
}

fn current_modifiers() -> Modifiers {
    Modifiers {
        ctrl: is_down(VK_CONTROL.0),
        shift: is_down(VK_SHIFT.0),
        alt: is_down(VK_MENU.0),
        win: is_down(VK_LWIN.0) || is_down(VK_RWIN.0),
    }
}

fn dispatch_key(vk: u32, down: bool) -> Option<LRESULT> {
    let hook = HOOK.get()?;
    let outcome = match hook.state.lock() {
        Ok(mut state) => state.on_key(vk, down, current_modifiers()),
        Err(_) => return None,
    };
    if let Some(event) = outcome.event {
        let _ = hook.events.send(event);
    }
    outcome.swallow.then_some(LRESULT(1))
}

/// Windows silently removes slow low-level hooks, so this only matches and forwards.
unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        if info.dwExtraInfo != SYNTHETIC_INPUT_MARK {
            let down = matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
            if let Some(swallowed) = dispatch_key(info.vkCode, down) {
                return swallowed;
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
        if info.dwExtraInfo != SYNTHETIC_INPUT_MARK {
            if let Some((vk, down)) = mouse_button(wparam.0 as u32, info.mouseData) {
                if let Some(swallowed) = dispatch_key(vk, down) {
                    return swallowed;
                }
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn mouse_button(message: u32, mouse_data: u32) -> Option<(u32, bool)> {
    match message {
        WM_RBUTTONDOWN => Some((VK_RBUTTON, true)),
        WM_RBUTTONUP => Some((VK_RBUTTON, false)),
        WM_MBUTTONDOWN => Some((VK_MBUTTON, true)),
        WM_MBUTTONUP => Some((VK_MBUTTON, false)),
        WM_XBUTTONDOWN => Some((xbutton_vk(mouse_data)?, true)),
        WM_XBUTTONUP => Some((xbutton_vk(mouse_data)?, false)),
        _ => None,
    }
}

fn xbutton_vk(mouse_data: u32) -> Option<u32> {
    match mouse_data >> 16 {
        1 => Some(VK_XBUTTON1),
        2 => Some(VK_XBUTTON2),
        _ => None,
    }
}
