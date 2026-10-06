import { useEffect, useState } from "react";
import { BrandMark } from "@/app/BrandMark";
import { Tooltip } from "@/components/Tooltip";

/** Selectable main-pane destinations, including Voice children. */
export type AppSection =
  | "dictation"
  | "dictionary"
  | "capture"
  | "notes"
  | "handoffs"
  | "transforms"
  | "assistant"
  | "devices"
  | "settings"
  | "analytics";

export type VoiceSection =
  | "dictation"
  | "dictionary"
  | "capture"
  | "notes"
  | "handoffs"
  | "transforms";

type TopSection = "voice" | "assistant" | "devices" | "settings" | "analytics";

const SECTION_META: Record<AppSection, { label: string; title?: string }> = {
  dictation: { label: "Dictations" },
  dictionary: { label: "Dictionary" },
  capture: { label: "Selection" },
  notes: { label: "Notes" },
  handoffs: { label: "Handoffs" },
  transforms: { label: "Transforms" },
  assistant: { label: "Assistant" },
  devices: { label: "Devices & Controls" },
  settings: { label: "Settings" },
  analytics: { label: "Analytics" },
};

const VOICE_CHILDREN: readonly VoiceSection[] = [
  "dictation",
  "dictionary",
  "capture",
  "notes",
  "handoffs",
  "transforms",
];

const TOP_SECTIONS: readonly TopSection[] = ["voice", "assistant", "devices", "settings", "analytics"];
const TOP_LABELS: Record<TopSection, string> = {
  voice: "Voice",
  assistant: "Assistant",
  devices: "Devices & Controls",
  settings: "Settings",
  analytics: "Analytics",
};

const COLLAPSED_KEY = "ui.sidebar.collapsed";
const VOICE_OPEN_KEY = "ui.sidebar.voiceOpen";
const MOBILE_MQ = "(max-width: 720px)";

/** Title for the section shown in the main pane. */
export function sectionMeta(section: AppSection): { label: string } {
  const meta = SECTION_META[section];
  return { label: meta.title ?? meta.label };
}

export function isVoiceSection(section: AppSection): section is VoiceSection {
  return (VOICE_CHILDREN as readonly string[]).includes(section);
}

/** Android always uses the hamburger shell; desktop width only matters on Windows. */
export function preferMobileNav(userAgent: string, widthMatches: boolean): boolean {
  return /\bAndroid\b/.test(userAgent) || widthMatches;
}

/** True when the shell should use the hamburger drawer instead of a persistent sidebar. */
export function useMobileNav(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined"
      ? preferMobileNav(navigator.userAgent, window.matchMedia(MOBILE_MQ).matches)
      : false,
  );

  useEffect(() => {
    if (/\bAndroid\b/.test(navigator.userAgent)) {
      setMobile(true);
      return;
    }
    const media = window.matchMedia(MOBILE_MQ);
    const sync = () => setMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return mobile;
}

function loadCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (stored === null) return true;
    return stored === "1";
  } catch {
    return true;
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Preference is local chrome only; a write failure must not block navigation.
  }
}

function loadVoiceOpen(): boolean {
  try {
    const stored = localStorage.getItem(VOICE_OPEN_KEY);
    if (stored === null) return true;
    return stored === "1";
  } catch {
    return true;
  }
}

function saveVoiceOpen(open: boolean): void {
  try {
    localStorage.setItem(VOICE_OPEN_KEY, open ? "1" : "0");
  } catch {
    // Preference is local chrome only; a write failure must not block navigation.
  }
}

interface AppNavProps {
  section: AppSection;
  microphoneOn: boolean;
  onSelect(section: AppSection): void;
  /** When set, render as a slide-out drawer (always expanded labels). */
  drawer?: boolean;
  drawerOpen?: boolean;
  onDrawerClose?(): void;
  /** Windows floating overlay on/off. Omitted on platforms without that preference. */
  showFloatingControl?: boolean;
  onFloatingControlChange?(show: boolean): void;
}

/** Persistent section switcher. Selection stays in component state; it does not change the route. */
export function AppNav({
  section,
  microphoneOn,
  onSelect,
  drawer = false,
  drawerOpen = false,
  onDrawerClose,
  showFloatingControl,
  onFloatingControlChange,
}: AppNavProps) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [voiceOpen, setVoiceOpen] = useState(loadVoiceOpen);
  const micLabel = microphoneOn ? "Microphone on" : "Microphone off";
  const voiceActive = isVoiceSection(section);
  const railCollapsed = drawer ? false : collapsed;
  const showVoiceChildren = voiceOpen && !railCollapsed;

  useEffect(() => {
    if (!drawer || !drawerOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onDrawerClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, drawerOpen, onDrawerClose]);

  function toggleCollapsed() {
    if (drawer) return;
    setCollapsed((current) => {
      const next = !current;
      saveCollapsed(next);
      return next;
    });
  }

  function setVoiceExpanded(open: boolean) {
    setVoiceOpen(open);
    saveVoiceOpen(open);
  }

  function toggleVoiceGroup() {
    if (railCollapsed) {
      setCollapsed(false);
      saveCollapsed(false);
      setVoiceExpanded(true);
      if (!voiceActive) onSelect("dictation");
      return;
    }
    const next = !voiceOpen;
    setVoiceExpanded(next);
    if (next && !voiceActive) onSelect("dictation");
  }

  function selectChild(child: VoiceSection) {
    if (!voiceOpen) setVoiceExpanded(true);
    onSelect(child);
  }

  function selectTop(id: Exclude<TopSection, "voice">) {
    onSelect(id);
  }

  const sidebarClass = [
    "app-sidebar",
    railCollapsed ? "is-collapsed" : "",
    drawer ? "is-drawer" : "",
    drawer && drawerOpen ? "is-open" : "",
  ].filter(Boolean).join(" ");

  return (
    <aside
      id={drawer ? "app-nav-drawer" : undefined}
      className={sidebarClass}
      aria-hidden={drawer && !drawerOpen ? true : undefined}
    >
      <div className="app-brand">
        {drawer ? (
          <span className="brand-mark-wrap" aria-hidden="true">
            <BrandMark />
            <span
              className={microphoneOn ? "mic-dot is-on" : "mic-dot is-off"}
              aria-hidden="true"
            />
          </span>
        ) : (
          <Tooltip content={collapsed ? `Expand menu · ${micLabel}` : `Collapse menu · ${micLabel}`}>
            <button
              type="button"
              className="app-brand-toggle"
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand menu" : "Collapse menu"}
              onClick={toggleCollapsed}
            >
              <span className="brand-mark-wrap">
                <BrandMark />
                <span
                  className={microphoneOn ? "mic-dot is-on" : "mic-dot is-off"}
                  aria-hidden="true"
                />
              </span>
            </button>
          </Tooltip>
        )}
        <h1>Personal Voice</h1>
        <span className="visually-hidden" role="status">{micLabel}</span>
        {drawer && (
          <button
            type="button"
            className="app-drawer-close"
            aria-label="Close menu"
            onClick={() => onDrawerClose?.()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <nav className="app-nav" aria-label="Personal Voice">
        {TOP_SECTIONS.map((id) => {
          const label = TOP_LABELS[id];
          if (id === "voice") {
            const groupClass = [
              "app-nav-group",
              voiceActive ? "is-active" : "",
              showVoiceChildren ? "is-open" : "",
            ].filter(Boolean).join(" ");
            return (
              <div key={id} className={groupClass}>
                <Tooltip content={railCollapsed ? label : voiceOpen ? "Collapse Voice" : "Expand Voice"}>
                  <button
                    type="button"
                    className="app-nav-item app-nav-parent"
                    aria-expanded={showVoiceChildren}
                    aria-controls="voice-nav-children"
                    aria-label={railCollapsed ? label : undefined}
                    onClick={toggleVoiceGroup}
                  >
                    <NavIcon section={id} />
                    <span className="app-nav-label">{label}</span>
                    <span className="app-nav-chevron" aria-hidden="true">
                      <svg viewBox="0 0 12 12">
                        <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                </Tooltip>
                <div
                  id="voice-nav-children"
                  className="app-nav-children"
                  role="group"
                  aria-label="Voice"
                  hidden={!showVoiceChildren}
                >
                  {VOICE_CHILDREN.map((child) => {
                    const childLabel = SECTION_META[child].label;
                    return (
                      <button
                        key={child}
                        type="button"
                        className="app-nav-item app-nav-child"
                        aria-current={section === child ? "page" : undefined}
                        onClick={() => selectChild(child)}
                      >
                        <span className="app-nav-child-mark" aria-hidden="true" />
                        <span className="app-nav-label">{childLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          }
          return (
            <Tooltip key={id} content={railCollapsed ? label : undefined}>
              <button
                type="button"
                className="app-nav-item"
                aria-current={section === id ? "page" : undefined}
                aria-label={railCollapsed ? label : undefined}
                onClick={() => selectTop(id)}
              >
                <NavIcon section={id} />
                <span className="app-nav-label">{label}</span>
              </button>
            </Tooltip>
          );
        })}
      </nav>
      {showFloatingControl !== undefined && onFloatingControlChange && (
        <div className="app-sidebar-footer">
          <Tooltip
            content={
              showFloatingControl
                ? "Hide the floating control over other apps"
                : "Show a small button over other apps"
            }
          >
            <label className="app-sidebar-toggle">
              <input
                type="checkbox"
                checked={showFloatingControl}
                aria-label="Floating control"
                onChange={(event) => onFloatingControlChange(event.target.checked)}
              />
              <span className="app-sidebar-toggle-icon" aria-hidden="true">
                <FloatingControlIcon />
              </span>
              <span className="app-nav-label">Floating control</span>
            </label>
          </Tooltip>
        </div>
      )}
    </aside>
  );
}

function FloatingControlIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function NavIcon({ section }: { section: TopSection }) {
  switch (section) {
    case "voice":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M6 11a6 6 0 0 0 12 0M12 17v3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "assistant":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6.5h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H11l-4 3.2V16.5H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      );
    case "devices":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="11" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 19h18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"
            fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
          />
        </svg>
      );
    case "analytics":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 19V10M10 19V5M15 19v-7M20 19V8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    default: {
      const unhandled: never = section;
      throw new Error(`Unhandled section: ${String(unhandled)}`);
    }
  }
}
