import { useState } from "react";
import { BrandMark } from "@/app/BrandMark";

export type AppSection = "voice" | "devices" | "settings";

const SECTION_META: Record<AppSection, { label: string }> = {
  voice: { label: "Voice" },
  devices: { label: "Devices & Controls" },
  settings: { label: "Settings" },
};

const APP_SECTIONS: readonly AppSection[] = ["voice", "devices", "settings"];
const COLLAPSED_KEY = "ui.sidebar.collapsed";

/** Title for the section shown in the main pane. */
export function sectionMeta(section: AppSection): { label: string } {
  return SECTION_META[section];
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

interface AppNavProps {
  section: AppSection;
  microphoneOn: boolean;
  onSelect(section: AppSection): void;
}

/** Persistent section switcher. Selection stays in component state; it does not change the route. */
export function AppNav({ section, microphoneOn, onSelect }: AppNavProps) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const micLabel = microphoneOn ? "Microphone on" : "Microphone off";

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      saveCollapsed(next);
      return next;
    });
  }

  return (
    <aside className={collapsed ? "app-sidebar is-collapsed" : "app-sidebar"}>
      <div className="app-brand">
        <button
          type="button"
          className="app-brand-toggle"
          aria-expanded={!collapsed}
          title={collapsed ? "Expand menu" : "Collapse menu"}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          onClick={toggleCollapsed}
        >
          <BrandMark />
        </button>
        <h1>Personal Voice</h1>
      </div>
      <nav className="app-nav" aria-label="Personal Voice">
        {APP_SECTIONS.map((id) => {
          const label = SECTION_META[id].label;
          return (
            <button
              key={id}
              type="button"
              className="app-nav-item"
              aria-current={section === id ? "page" : undefined}
              aria-label={collapsed ? label : undefined}
              title={collapsed ? label : undefined}
              onClick={() => onSelect(id)}
            >
              <NavIcon section={id} />
              <span className="app-nav-label">{label}</span>
            </button>
          );
        })}
      </nav>
      <p className="sidebar-status" title={micLabel}>
        <span className={microphoneOn ? "mic-dot is-on" : "mic-dot"} aria-hidden="true" />
        <span className="sidebar-status-text">{micLabel}</span>
      </p>
    </aside>
  );
}

function NavIcon({ section }: { section: AppSection }) {
  switch (section) {
    case "voice":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M6 11a6 6 0 0 0 12 0M12 17v3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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
    default: {
      const unhandled: never = section;
      throw new Error(`Unhandled section: ${String(unhandled)}`);
    }
  }
}
