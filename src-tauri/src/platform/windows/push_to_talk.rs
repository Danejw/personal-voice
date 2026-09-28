//! Push-to-talk shortcut parsing and key matching. Pure logic over Windows
//! virtual-key codes so it can be unit-tested without a keyboard hook.

pub const VK_ESCAPE: u32 = 0x1B;

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

fn key_code(name: &str) -> Option<u32> {
    let lower = name.to_ascii_lowercase();
    let named = match lower.as_str() {
        "rightalt" => Some(0xA5),
        "rightctrl" => Some(0xA3),
        "rightshift" => Some(0xA1),
        "space" => Some(0x20),
        "capslock" => Some(0x14),
        "scrolllock" => Some(0x91),
        "pause" => Some(0x13),
        "insert" => Some(0x2D),
        "escape" | "esc" => Some(VK_ESCAPE),
        _ => None,
    };
    if named.is_some() {
        return named;
    }
    if let Some(n) = lower.strip_prefix('f').and_then(|n| n.parse::<u32>().ok()) {
        return (1..=24).contains(&n).then(|| 0x70 + n - 1);
    }
    match lower.as_bytes() {
        [c @ b'a'..=b'z'] => Some(u32::from(c.to_ascii_uppercase())),
        [c @ b'0'..=b'9'] => Some(u32::from(*c)),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PttEvent {
    Press,
    Release,
    Cancel,
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

/// Tracks one held shortcut so auto-repeat never starts a second utterance.
#[derive(Default)]
pub struct PushToTalk {
    pub shortcut: Shortcut,
    /// While true, Escape cancels the active utterance.
    pub active: bool,
    pub paused: bool,
    held: bool,
    escape_held: bool,
}

impl PushToTalk {
    pub fn set_shortcut(&mut self, shortcut: Shortcut) {
        self.shortcut = shortcut;
        self.held = false;
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.paused = paused;
        self.held = false;
        self.escape_held = false;
    }

    /// `modifiers` is the state of the other modifier keys before this event.
    pub fn on_key(&mut self, vk: u32, down: bool, modifiers: Modifiers) -> Outcome {
        if self.paused {
            return PASS;
        }
        if vk == self.shortcut.vk {
            return match (down, self.held) {
                (true, true) => SWALLOW,
                (true, false) if modifiers == self.shortcut.modifiers => {
                    self.held = true;
                    Outcome {
                        swallow: true,
                        event: Some(PttEvent::Press),
                    }
                }
                (false, true) => {
                    self.held = false;
                    Outcome {
                        swallow: true,
                        event: Some(PttEvent::Release),
                    }
                }
                _ => PASS,
            };
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
            "Tab",
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
            [PttEvent::Press, PttEvent::Release]
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
        assert_eq!(ptt.on_key(0x20, true, ctrl).event, Some(PttEvent::Press));
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
            Some(PttEvent::Press)
        );
    }
}
