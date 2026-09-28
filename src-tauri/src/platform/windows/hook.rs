//! Global low-level keyboard hook for push-to-talk. Unlike `RegisterHotKey`,
//! it reports key-up and supports a lone key such as Right Alt.

use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};

use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, HC_ACTION,
    KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
};

use super::push_to_talk::{Modifiers, PttEvent, PushToTalk, Shortcut};

/// Marks input this app synthesizes (the paste chord) so the hook ignores it.
pub const SYNTHETIC_INPUT_MARK: usize = 0x5056_4F49;

struct Hook {
    state: Mutex<PushToTalk>,
    events: Sender<PttEvent>,
}

static HOOK: OnceLock<Hook> = OnceLock::new();

/// Installs the hook on its own message-loop thread; `on_event` runs on another thread.
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

/// Windows silently removes slow low-level hooks, so this only matches and forwards.
unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        if info.dwExtraInfo != SYNTHETIC_INPUT_MARK {
            if let Some(hook) = HOOK.get() {
                let down = matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
                let outcome = match hook.state.lock() {
                    Ok(mut state) => state.on_key(info.vkCode, down, current_modifiers()),
                    Err(_) => return unsafe { CallNextHookEx(None, code, wparam, lparam) },
                };
                if let Some(event) = outcome.event {
                    let _ = hook.events.send(event);
                }
                if outcome.swallow {
                    return LRESULT(1);
                }
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}
