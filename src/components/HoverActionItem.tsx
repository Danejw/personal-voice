import type { ReactNode } from "react";
import { Tooltip } from "@/components/Tooltip";

/** Actions the shared hover tray knows how to draw. */
export type TrayActionKind = "copy" | "insert" | "archive" | "unarchive" | "delete" | "dismiss" | "attach";

export interface TrayAction {
  kind: TrayActionKind;
  /** Replaces the default label when the same icon attaches or removes. */
  label?: string;
  disabled?: boolean;
  onClick(): void;
}

interface HoverActionItemProps {
  busy?: boolean;
  actions: readonly TrayAction[];
  children: ReactNode;
}

/** List row whose text stays full width. Icon actions appear over the corner on hover or focus. */
export function HoverActionItem({ busy = false, actions, children }: HoverActionItemProps) {
  return (
    <li className={busy ? "action-item is-busy" : "action-item"}>
      {children}
      <div className="item-actions">
        {actions.map((action) => {
          const label = action.label ?? labelFor(action.kind);
          return (
            <Tooltip key={action.kind} content={label}>
              <button
                type="button"
                className={isDanger(action.kind) ? "icon-btn icon-btn-danger" : "icon-btn"}
                aria-label={label}
                disabled={busy || action.disabled}
                onClick={action.onClick}
              >
                <ActionIcon kind={action.kind} />
              </button>
            </Tooltip>
          );
        })}
      </div>
    </li>
  );
}

function isDanger(kind: TrayActionKind): boolean {
  switch (kind) {
    case "delete":
    case "dismiss":
      return true;
    case "copy":
    case "insert":
    case "archive":
    case "unarchive":
    case "attach":
      return false;
    default: {
      const unhandled: never = kind;
      throw new Error(`Unhandled tray action: ${String(unhandled)}`);
    }
  }
}

function labelFor(kind: TrayActionKind): string {
  switch (kind) {
    case "copy": return "Copy";
    case "insert": return "Insert";
    case "archive": return "Archive";
    case "unarchive": return "Unarchive";
    case "delete": return "Delete";
    case "dismiss": return "Dismiss";
    case "attach": return "Attach to Assistant";
    default: {
      const unhandled: never = kind;
      throw new Error(`Unhandled tray action: ${String(unhandled)}`);
    }
  }
}

function ActionIcon({ kind }: { kind: TrayActionKind }) {
  switch (kind) {
    case "copy":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="8" y="8" width="11" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="M6 16H5.5A1.5 1.5 0 0 1 4 14.5v-9A1.5 1.5 0 0 1 5.5 4h8A1.5 1.5 0 0 1 15 5.5V6" fill="none" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      );
    case "insert":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4v9M8 9l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 16h14v4H5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
      );
    case "archive":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16v3H4zM6 10v8h12v-8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M10 14h4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "unarchive":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 10h16v3H4zM6 13v7h12v-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M12 6v7M9 9l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "delete":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 8h14M9 8V6h6v2M8 8l1 12h6l1-12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "dismiss":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "attach":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v10M8 11l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6 19h12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    default: {
      const unhandled: never = kind;
      throw new Error(`Unhandled tray action: ${String(unhandled)}`);
    }
  }
}
