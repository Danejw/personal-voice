//! Push-to-talk shortcut parsing and key matching. Pure logic over Windows
//! virtual-key codes so it can be unit-tested without a keyboard hook.

pub const VK_ESCAPE: u32 = 0x1B;
pub const VK_LBUTTON: u32 = 0x01;
pub const VK_RBUTTON: u32 = 0x02;
pub const VK_MBUTTON: u32 = 0x04;
pub const VK_XBUTTON1: u32 = 0x05;
pub const VK_XBUTTON2: u32 = 0x06;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Modifiers {
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
    pub win: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Shortcut {
    pub modifiers: Modifiers,
    pub vk: u32,
}

impl Shortcut {
    pub fn is_mouse(self) -> bool {
        matches!(self.vk, VK_RBUTTON | VK_MBUTTON | VK_XBUTTON1 | VK_XBUTTON2)
    }

    /// Parses `"RightAlt"`, `"Ctrl+Shift+Space"`, `"F9"`, etc. Names are case-insensitive.
    pub fn parse(text: &str) -> Result<Self, String> {
        let parts: Vec<&str> = text.split('+').map(str::trim).collect();
        let (key, mods) = parts.split_last().ok_or("Shortcut is empty.")?;
        let mut modifiers = Modifiers::default();
        for name in mods {
            let flag = match name.to_ascii_lowercase().as_str() {
                "ctrl" | "control" => &mut modifiers.ctrl,
                "shift" => &mut modifiers.shift,
                "alt" => &mut modifiers.alt,
                "win" | "super" => &mut modifiers.win,
                _ => return Err(format!("Unknown modifier \"{name}\".")),
            };
            if *flag {
                return Err(format!("Modifier \"{name}\" is repeated."));
            }
            *flag = true;
        }
        let vk = key_code(key).ok_or_else(|| format!("Unsupported key \"{key}\"."))?;
        if vk == VK_ESCAPE {
            return Err("Escape is reserved for cancelling dictation.".into());
        }
        Ok(Self { modifiers, vk })
    }
}

impl Default for Shortcut {
    fn default() -> Self {
        Self::parse("RightAlt").expect("default shortcut parses")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LongPressShortcut {
    pub shortcut: Shortcut,
    pub hold_ms: u64,
}

impl LongPressShortcut {
    pub fn new(shortcut: Shortcut, hold_ms: u64) -> Result<Self, String> {
        if !shortcut.is_mouse() {
            return Err("Long press currently supports mouse buttons only.".into());
        }
        if !(200..=2_000).contains(&hold_ms) {
            return Err("Long-press hold time must be between 200 and 2000 ms.".into());
        }
        Ok(Self { shortcut, hold_ms })
    }
}

fn key_code(name: &str) -> Option<u32> {
    let lower = name.to_ascii_lowercase();
    if let Some(vk) = named_key(&lower) {
        return Some(vk);
    }
    if let Some(raw) = lower.strip_prefix("vk") {
        let vk = raw.parse::<u32>().ok()?;
        if (1..255).contains(&vk) && vk != VK_ESCAPE && vk != VK_LBUTTON {
            return Some(vk);
        }
        return None;
    }
    if let Some(rest) = lower.strip_prefix('f') {
        if !rest.is_empty() && rest.bytes().all(|byte| byte.is_ascii_digit()) {
            let n = rest.parse::<u32>().ok()?;
            return (1..=24).contains(&n).then(|| 0x70 + n - 1);
        }
    }
    if let Some(rest) = lower.strip_prefix("numpad") {
        if let Ok(n) = rest.parse::<u32>() {
            return (0..=9).contains(&n).then(|| 0x60 + n);
        }
    }
    match lower.as_bytes() {
        [c @ b'a'..=b'z'] => Some(u32::from(c.to_ascii_uppercase())),
        [c @ b'0'..=b'9'] => Some(u32::from(*c)),
        _ => None,
    }
}

fn named_key(name: &str) -> Option<u32> {
    Some(match name {
        "rightalt" => 0xA5,
        "leftalt" => 0xA4,
        "rightctrl" => 0xA3,
        "leftctrl" => 0xA2,
        "rightshift" => 0xA1,
        "leftshift" => 0xA0,
        "rightwin" => 0x5C,
        "leftwin" => 0x5B,
        "space" => 0x20,
        "capslock" => 0x14,
        "scrolllock" => 0x91,
        "pause" => 0x13,
        "insert" => 0x2D,
        "mouse4" | "xbutton1" => VK_XBUTTON1,
        "mouse5" | "xbutton2" => VK_XBUTTON2,
        "mousemiddle" | "middle" => VK_MBUTTON,
        "mouseright" => VK_RBUTTON,
        "escape" | "esc" => VK_ESCAPE,
        "tab" => 0x09,
        "enter" | "return" => 0x0D,
        "backspace" => 0x08,
        "delete" => 0x2E,
        "home" => 0x24,
        "end" => 0x23,
        "pageup" => 0x21,
        "pagedown" => 0x22,
        "up" => 0x26,
        "down" => 0x28,
        "left" => 0x25,
        "right" => 0x27,
        "backquote" => 0xC0,
        "minus" => 0xBD,
        "equal" => 0xBB,
        "bracketleft" => 0xDB,
        "bracketright" => 0xDD,
        "backslash" => 0xDC,
        "semicolon" => 0xBA,
        "quote" => 0xDE,
        "comma" => 0xBC,
        "period" => 0xBE,
        "slash" => 0xBF,
        "numpadmultiply" => 0x6A,
        "numpadadd" => 0x6B,
        "numpadsubtract" => 0x6D,
        "numpaddecimal" => 0x6E,
        "numpaddivide" => 0x6F,
        _ => return None,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DestOverride {
    VoiceNote,
    Handoff,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PttEvent {
    Press {
        destination: Option<DestOverride>,
    },
    /// One-shot: copies the highlighted text. Release is swallowed and does not end dictation.
    CaptureSelection,
    /// One-shot: starts or ends Assistant. Release is swallowed and does not end dictation.
    ToggleAssistant,
    Release,
    Cancel,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HeldAction {
    Talk,
    OneShot,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Outcome {
    /// Hide the key from other applications.
    pub swallow: bool,
    pub event: Option<PttEvent>,
}

const PASS: Outcome = Outcome {
    swallow: false,
    event: None,
};
const SWALLOW: Outcome = Outcome {
    swallow: true,
    event: None,
};

/// Tracks held shortcuts so auto-repeat never starts a second utterance.
pub struct PushToTalk {
    pub dictate: Vec<Shortcut>,
    pub dictate_long_press: Vec<LongPressShortcut>,
    pub voice_note: Vec<Shortcut>,
    pub handoff: Vec<Shortcut>,
    pub selection: Vec<Shortcut>,
    pub assistant: Vec<Shortcut>,
    /// While true, Escape cancels the active utterance.
    pub active: bool,
    pub paused: bool,
    /// Settings is recording a new binding, so the hook must not swallow keys.
    pub capturing: bool,
    held: Option<(u32, HeldAction)>,
    escape_held: bool,
}

impl Default for PushToTalk {
    fn default() -> Self {
        Self {
            dictate: vec![Shortcut::default()],
            dictate_long_press: Vec::new(),
            voice_note: Vec::new(),
            handoff: Vec::new(),
            selection: Vec::new(),
            assistant: Vec::new(),
            active: false,
            paused: false,
            capturing: false,
            held: None,
            escape_held: false,
        }
    }
}

impl PushToTalk {
    pub fn set_shortcut(&mut self, shortcut: Shortcut) {
        self.dictate = vec![shortcut];
        self.dictate_long_press.retain(|binding| binding.shortcut != shortcut);
        self.held = None;
    }

    pub fn set_hotkeys(
        &mut self,
        dictate: Vec<Shortcut>,
        voice_note: Vec<Shortcut>,
        handoff: Vec<Shortcut>,
        selection: Vec<Shortcut>,
        assistant: Vec<Shortcut>,
    ) -> Result<(), String> {
        self.set_all_hotkeys(
            dictate,
            self.dictate_long_press.clone(),
            voice_note,
            handoff,
            selection,
            assistant,
        )
    }

    pub fn set_long_press_hotkeys(&mut self, bindings: Vec<LongPressShortcut>) -> Result<(), String> {
        self.set_all_hotkeys(
            self.dictate.clone(),
            bindings,
            self.voice_note.clone(),
            self.handoff.clone(),
            self.selection.clone(),
            self.assistant.clone(),
        )
    }

    pub fn set_all_hotkeys(
        &mut self,
        dictate: Vec<Shortcut>,
        dictate_long_press: Vec<LongPressShortcut>,
        voice_note: Vec<Shortcut>,
        handoff: Vec<Shortcut>,
        selection: Vec<Shortcut>,
        assistant: Vec<Shortcut>,
    ) -> Result<(), String> {
        if dictate.is_empty() {
            return Err("Hold to dictate needs a key or mouse button.".into());
        }
        ensure_unique(&[&dictate, &voice_note, &handoff, &selection, &assistant], &dictate_long_press)?;
        self.dictate = dictate;
        self.dictate_long_press = dictate_long_press;
        self.voice_note = voice_note;
        self.handoff = handoff;
        self.selection = selection;
        self.assistant = assistant;
        self.held = None;
        Ok(())
    }

    pub fn long_press_delay(&self, vk: u32, modifiers: Modifiers) -> Option<u64> {
        if self.paused || self.capturing || self.held.is_some() {
            return None;
        }
        self.dictate_long_press
            .iter()
            .find(|binding| matches_shortcut(&binding.shortcut, vk, modifiers))
            .map(|binding| binding.hold_ms)
    }

    pub fn begin_long_press(&mut self, vk: u32, modifiers: Modifiers) -> Option<PttEvent> {
        self.long_press_delay(vk, modifiers)?;
        self.held = Some((vk, HeldAction::Talk));
        Some(PttEvent::Press { destination: None })
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.paused = paused;
        self.held = None;
        self.escape_held = false;
    }

    pub fn set_capturing(&mut self, capturing: bool) {
        self.capturing = capturing;
        self.held = None;
        self.escape_held = false;
    }

    /// `modifiers` is the state of the other modifier keys before this event.
    pub fn on_key(&mut self, vk: u32, down: bool, modifiers: Modifiers) -> Outcome {
        if self.paused || self.capturing {
            return PASS;
        }
        if let Some((held, action)) = self.held {
            if vk == held {
                return match down {
                    true => SWALLOW,
                    false => {
                        self.held = None;
                        match action {
                            HeldAction::Talk => Outcome {
                                swallow: true,
                                event: Some(PttEvent::Release),
                            },
                            HeldAction::OneShot => SWALLOW,
                        }
                    }
                };
            }
        } else if down {
            if let Some(event) = self.match_press(vk, modifiers) {
                let action = match event {
                    PttEvent::CaptureSelection | PttEvent::ToggleAssistant => HeldAction::OneShot,
                    _ => HeldAction::Talk,
                };
                self.held = Some((vk, action));
                return Outcome {
                    swallow: true,
                    event: Some(event),
                };
            }
        }
        if vk == VK_ESCAPE {
            return match (down, self.escape_held) {
                (true, true) => SWALLOW,
                (true, false) if self.active => {
                    self.escape_held = true;
                    Outcome {
                        swallow: true,
                        event: Some(PttEvent::Cancel),
                    }
                }
                (false, true) => {
                    self.escape_held = false;
                    SWALLOW
                }
                _ => PASS,
            };
        }
        PASS
    }

    fn match_press(&self, vk: u32, modifiers: Modifiers) -> Option<PttEvent> {
        if self
            .dictate
            .iter()
            .any(|shortcut| matches_shortcut(shortcut, vk, modifiers))
        {
            return Some(PttEvent::Press { destination: None });
        }
        if self
            .voice_note
            .iter()
            .any(|shortcut| matches_shortcut(shortcut, vk, modifiers))
        {
            return Some(PttEvent::Press {
                destination: Some(DestOverride::VoiceNote),
            });
        }
        if self
            .handoff
            .iter()
            .any(|shortcut| matches_shortcut(shortcut, vk, modifiers))
        {
            return Some(PttEvent::Press {
                destination: Some(DestOverride::Handoff),
            });
        }
        if self
            .selection
            .iter()
            .any(|shortcut| matches_shortcut(shortcut, vk, modifiers))
        {
            return Some(PttEvent::CaptureSelection);
        }
        if self
            .assistant
            .iter()
            .any(|shortcut| matches_shortcut(shortcut, vk, modifiers))
        {
            return Some(PttEvent::ToggleAssistant);
        }
        None
    }
}

fn matches_shortcut(shortcut: &Shortcut, vk: u32, modifiers: Modifiers) -> bool {
    shortcut.vk == vk && shortcut.modifiers == modifiers
}

fn ensure_unique(lists: &[&[Shortcut]], long_press: &[LongPressShortcut]) -> Result<(), String> {
    let mut seen: Vec<Shortcut> = Vec::new();
    for list in lists {
        for shortcut in *list {
            if seen.contains(shortcut) {
                return Err("Each binding needs its own key or mouse button.".into());
            }
            seen.push(*shortcut);
        }
    }
    for binding in long_press {
        if seen.contains(&binding.shortcut) {
            return Err("Each binding needs its own key or mouse button.".into());
        }
        seen.push(binding.shortcut);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const NONE: Modifiers = Modifiers {
        ctrl: false,
        shift: false,
        alt: false,
        win: false,
    };
    const RIGHT_ALT: u32 = 0xA5;

    #[test]
    fn parses_supported_shortcuts() {
        assert_eq!(
            Shortcut::default(),
            Shortcut {
                modifiers: NONE,
                vk: RIGHT_ALT
            }
        );
        let combo = Shortcut::parse("Ctrl+Shift+Space").unwrap();
        assert_eq!(
            combo,
            Shortcut {
                modifiers: Modifiers {
                    ctrl: true,
                    shift: true,
                    ..NONE
                },
                vk: 0x20
            }
        );
        assert_eq!(Shortcut::parse("f9").unwrap().vk, 0x78);
        assert_eq!(Shortcut::parse("F24").unwrap().vk, 0x87);
        assert_eq!(Shortcut::parse("Alt+d").unwrap().vk, 0x44);
        assert_eq!(Shortcut::parse("ScrollLock").unwrap().vk, 0x91);
        assert_eq!(Shortcut::parse("Mouse4").unwrap().vk, VK_XBUTTON1);
        assert_eq!(Shortcut::parse("Mouse5").unwrap().vk, VK_XBUTTON2);
        assert_eq!(Shortcut::parse("MouseMiddle").unwrap().vk, VK_MBUTTON);
        assert_eq!(Shortcut::parse("LeftAlt").unwrap().vk, 0xA4);
        assert_eq!(Shortcut::parse("MouseRight").unwrap().vk, VK_RBUTTON);
        assert_eq!(Shortcut::parse("VK65").unwrap().vk, 0x41);
        assert_eq!(Shortcut::parse("Ctrl+Mouse5").unwrap().modifiers.ctrl, true);
    }

    #[test]
    fn rejects_invalid_shortcuts() {
        for bad in [
            "",
            "Ctrl+",
            "Hyper+A",
            "Ctrl+Ctrl+A",
            "F25",
            "Escape",
            "VK27",
            "VK1",
        ] {
            assert!(Shortcut::parse(bad).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn auto_repeat_produces_one_press_and_one_release() {
        let mut ptt = PushToTalk::default();
        let events: Vec<_> = [true, true, true, false, false]
            .into_iter()
            .map(|down| ptt.on_key(RIGHT_ALT, down, NONE))
            .collect();
        assert_eq!(
            events.iter().filter_map(|o| o.event).collect::<Vec<_>>(),
            [PttEvent::Press { destination: None }, PttEvent::Release]
        );
        assert!(events[..4].iter().all(|o| o.swallow));
        assert_eq!(events[4], PASS);
    }

    #[test]
    fn requires_exact_modifiers() {
        let mut ptt = PushToTalk::default();
        ptt.set_shortcut(Shortcut::parse("Ctrl+Space").unwrap());
        let ctrl = Modifiers { ctrl: true, ..NONE };
        assert_eq!(ptt.on_key(0x20, true, NONE), PASS);
        assert_eq!(
            ptt.on_key(
                0x20,
                true,
                Modifiers {
                    shift: true,
                    ..ctrl
                }
            ),
            PASS
        );
        assert_eq!(
            ptt.on_key(0x20, true, ctrl).event,
            Some(PttEvent::Press { destination: None })
        );
        // Releasing Ctrl first still ends the utterance on the key's release.
        assert_eq!(ptt.on_key(0x20, false, NONE).event, Some(PttEvent::Release));
    }

    #[test]
    fn escape_cancels_only_while_active() {
        let mut ptt = PushToTalk::default();
        assert_eq!(ptt.on_key(VK_ESCAPE, true, NONE), PASS);
        ptt.active = true;
        assert_eq!(
            ptt.on_key(VK_ESCAPE, true, NONE).event,
            Some(PttEvent::Cancel)
        );
        assert_eq!(ptt.on_key(VK_ESCAPE, true, NONE), SWALLOW);
        assert_eq!(ptt.on_key(VK_ESCAPE, false, NONE), SWALLOW);
        assert_eq!(ptt.on_key(0x41, true, NONE), PASS);
    }

    #[test]
    fn paused_passes_everything_through() {
        let mut ptt = PushToTalk::default();
        ptt.set_paused(true);
        assert_eq!(ptt.on_key(RIGHT_ALT, true, NONE), PASS);
        ptt.set_paused(false);
        assert_eq!(
            ptt.on_key(RIGHT_ALT, true, NONE).event,
            Some(PttEvent::Press { destination: None })
        );
    }

    #[test]
    fn voice_note_and_handoff_hotkeys_override_the_destination() {
        let mut ptt = PushToTalk::default();
        ptt.set_hotkeys(
            vec![Shortcut::parse("RightAlt").unwrap()],
            vec![Shortcut::parse("Mouse4").unwrap()],
            vec![Shortcut::parse("Mouse5").unwrap()],
            vec![],
            vec![],
        )
        .unwrap();
        assert_eq!(
            ptt.on_key(VK_XBUTTON1, true, NONE).event,
            Some(PttEvent::Press {
                destination: Some(DestOverride::VoiceNote)
            })
        );
        assert_eq!(
            ptt.on_key(VK_XBUTTON1, false, NONE).event,
            Some(PttEvent::Release)
        );
        assert_eq!(
            ptt.on_key(VK_XBUTTON2, true, NONE).event,
            Some(PttEvent::Press {
                destination: Some(DestOverride::Handoff)
            })
        );
    }

    #[test]
    fn rejects_two_actions_on_the_same_button() {
        let mut ptt = PushToTalk::default();
        let f9 = Shortcut::parse("F9").unwrap();
        assert!(ptt.set_hotkeys(vec![f9], vec![f9], vec![], vec![], vec![]).is_err());
        assert!(ptt.set_hotkeys(vec![], vec![], vec![], vec![], vec![]).is_err());
    }

    #[test]
    fn right_mouse_and_right_alt_can_both_hold_to_dictate() {
        let mut ptt = PushToTalk::default();
        ptt.set_hotkeys(
            vec![
                Shortcut::parse("RightAlt").unwrap(),
                Shortcut::parse("MouseRight").unwrap(),
            ],
            vec![],
            vec![],
            vec![],
            vec![],
        )
        .unwrap();

        let right_down = ptt.on_key(VK_RBUTTON, true, NONE);
        assert!(right_down.swallow);
        assert_eq!(
            right_down.event,
            Some(PttEvent::Press { destination: None })
        );
        let right_up = ptt.on_key(VK_RBUTTON, false, NONE);
        assert!(right_up.swallow);
        assert_eq!(right_up.event, Some(PttEvent::Release));

        assert_eq!(
            ptt.on_key(RIGHT_ALT, true, NONE).event,
            Some(PttEvent::Press { destination: None })
        );
        assert_eq!(
            ptt.on_key(RIGHT_ALT, false, NONE).event,
            Some(PttEvent::Release)
        );
    }

    #[test]
    fn one_action_accepts_a_mouse_button_and_a_key() {
        let mut ptt = PushToTalk::default();
        ptt.set_hotkeys(
            vec![
                Shortcut::parse("RightAlt").unwrap(),
                Shortcut::parse("Mouse5").unwrap(),
            ],
            vec![
                Shortcut::parse("F9").unwrap(),
                Shortcut::parse("Ctrl+Shift+Space").unwrap(),
            ],
            vec![],
            vec![],
            vec![],
        )
        .unwrap();
        assert_eq!(
            ptt.on_key(VK_XBUTTON2, true, NONE).event,
            Some(PttEvent::Press { destination: None })
        );
        assert_eq!(
            ptt.on_key(VK_XBUTTON2, false, NONE).event,
            Some(PttEvent::Release)
        );
        let ctrl_shift = Modifiers {
            ctrl: true,
            shift: true,
            ..NONE
        };
        assert_eq!(
            ptt.on_key(0x20, true, ctrl_shift).event,
            Some(PttEvent::Press {
                destination: Some(DestOverride::VoiceNote)
            })
        );
    }

    #[test]
    fn capturing_passes_the_bound_key_through() {
        let mut ptt = PushToTalk::default();
        ptt.set_capturing(true);
        assert_eq!(ptt.on_key(RIGHT_ALT, true, NONE), PASS);
        ptt.set_capturing(false);
        assert_eq!(
            ptt.on_key(RIGHT_ALT, true, NONE).event,
            Some(PttEvent::Press { destination: None })
        );
    }

    #[test]
    fn selection_hotkey_fires_once_without_a_release_event() {
        let mut ptt = PushToTalk::default();
        ptt.set_hotkeys(
            vec![Shortcut::parse("RightAlt").unwrap()],
            vec![],
            vec![],
            vec![Shortcut::parse("Alt+S").unwrap()],
            vec![],
        )
        .unwrap();
        let alt = Modifiers { alt: true, ..NONE };
        assert_eq!(
            ptt.on_key(0x53, true, alt).event,
            Some(PttEvent::CaptureSelection)
        );
        assert_eq!(ptt.on_key(0x53, false, NONE), SWALLOW);
        assert_eq!(
            ptt.on_key(RIGHT_ALT, true, NONE).event,
            Some(PttEvent::Press { destination: None })
        );
    }

    #[test]
    fn assistant_hotkey_does_not_start_or_release_dictation() {
        let mut ptt = PushToTalk::default();
        ptt.set_hotkeys(
            vec![Shortcut::parse("RightAlt").unwrap()],
            vec![],
            vec![],
            vec![],
            vec![Shortcut::parse("Ctrl+Alt+A").unwrap()],
        )
        .unwrap();
        let ctrl_alt = Modifiers {
            ctrl: true,
            alt: true,
            ..NONE
        };
        assert_eq!(
            ptt.on_key(0x41, true, ctrl_alt).event,
            Some(PttEvent::ToggleAssistant)
        );
        assert_eq!(ptt.on_key(0x41, false, NONE), SWALLOW);
        assert!(ptt
            .set_hotkeys(
                vec![Shortcut::parse("RightAlt").unwrap()],
                vec![],
                vec![],
                vec![],
                vec![Shortcut::parse("RightAlt").unwrap()],
            )
            .is_err());
    }
}
