//! Global low-level keyboard and mouse hooks for push-to-talk. Unlike
//! `RegisterHotKey`, they report button-up and support a lone key such as Right Alt,
//! immediate mouse bindings, and delayed mouse holds that preserve a normal quick click.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEINPUT, MOUSE_EVENT_FLAGS,
    MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
    MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, HC_ACTION,
    KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_MBUTTONDOWN,
    WM_MBUTTONUP, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_SYSKEYDOWN, WM_XBUTTONDOWN, WM_XBUTTONUP,
};

use super::push_to_talk::{
    LongPressShortcut, Modifiers, PttEvent, PushToTalk, Shortcut, VK_MBUTTON, VK_RBUTTON,
    VK_XBUTTON1, VK_XBUTTON2,
};

/// Marks input this app synthesizes so the hook ignores it instead of re-triggering itself.
pub const SYNTHETIC_INPUT_MARK: usize = 0x5056_4F49;

#[derive(Clone, Copy)]
struct PendingLongPress {
    generation: u64,
    vk: u32,
    modifiers: Modifiers,
}

struct Hook {
    state: Mutex<PushToTalk>,
    events: Sender<PttEvent>,
    pending_long_press: Mutex<Option<PendingLongPress>>,
    long_press_generation: AtomicU64,
}

static HOOK: OnceLock<Hook> = OnceLock::new();

/// Installs the hooks on their own message-loop thread; `on_event` runs on another thread.
pub fn start(on_event: impl Fn(PttEvent) + Send + 'static) -> Result<(), String> {
    let (events, receiver) = channel();
    HOOK.set(Hook {
        state: Mutex::new(PushToTalk::default()),
        events,
        pending_long_press: Mutex::new(None),
        long_press_generation: AtomicU64::new(0),
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
    dictate_long_press: Vec<LongPressShortcut>,
    note: Vec<Shortcut>,
    handoff: Vec<Shortcut>,
    selection: Vec<Shortcut>,
    assistant: Vec<Shortcut>,
) -> Result<(), String> {
    match HOOK.get() {
        Some(hook) => match hook.state.lock() {
            Ok(mut state) => state.set_all_hotkeys(
                dictate,
                dictate_long_press,
                note,
                handoff,
                selection,
                assistant,
            ),
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

fn long_press_delay(vk: u32, modifiers: Modifiers) -> Option<u64> {
    let hook = HOOK.get()?;
    let state = hook.state.lock().ok()?;
    state.long_press_delay(vk, modifiers)
}

/// Starts a non-blocking hold timer. The low-level hook returns immediately.
fn begin_pending_long_press(vk: u32, modifiers: Modifiers, hold_ms: u64) -> bool {
    let Some(hook) = HOOK.get() else { return false };
    let generation = hook.long_press_generation.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let Ok(mut pending) = hook.pending_long_press.lock() else { return false };
        if pending.is_some() {
            return false;
        }
        *pending = Some(PendingLongPress { generation, vk, modifiers });
    }

    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(hold_ms));
        let Some(hook) = HOOK.get() else { return };
        let Ok(mut pending) = hook.pending_long_press.lock() else { return };
        let Some(current) = *pending else { return };
        if current.generation != generation || current.vk != vk {
            return;
        }
        let event = match hook.state.lock() {
            Ok(mut state) => state.begin_long_press(vk, current.modifiers),
            Err(_) => None,
        };
        if let Some(event) = event {
            // Send Press before releasing the pending lock so a simultaneous mouse-up
            // cannot enqueue Release ahead of it.
            let _ = hook.events.send(event);
            *pending = None;
        }
    });
    true
}

/// A release before the threshold is a normal click, not Dictation.
fn finish_pending_quick_click(vk: u32) -> bool {
    let Some(hook) = HOOK.get() else { return false };
    let pending = {
        let Ok(mut slot) = hook.pending_long_press.lock() else { return false };
        match *slot {
            Some(current) if current.vk == vk => slot.take(),
            _ => None,
        }
    };
    if pending.is_none() {
        return false;
    }
    if let Err(error) = replay_mouse_click(vk) {
        eprintln!("{error}");
    }
    true
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
                if down {
                    let modifiers = current_modifiers();
                    if let Some(delay) = long_press_delay(vk, modifiers) {
                        if begin_pending_long_press(vk, modifiers, delay) {
                            return LRESULT(1);
                        }
                    }
                } else if finish_pending_quick_click(vk) {
                    return LRESULT(1);
                }
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

fn replay_mouse_click(vk: u32) -> Result<(), String> {
    let (down, up, mouse_data) = match vk {
        VK_RBUTTON => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, 0),
        VK_MBUTTON => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, 0),
        VK_XBUTTON1 => (MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, 1),
        VK_XBUTTON2 => (MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, 2),
        _ => return Err("That mouse button cannot be replayed.".into()),
    };
    let inputs = [
        mouse_input(down, mouse_data),
        mouse_input(up, mouse_data),
    ];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err("Windows blocked the delayed mouse click.".into())
    }
}

fn mouse_input(flags: MOUSE_EVENT_FLAGS, mouse_data: u32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: mouse_data,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: SYNTHETIC_INPUT_MARK,
            },
        },
    }
}
