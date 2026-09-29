import type { ReactNode } from "react";
import { Tooltip } from "@/components/Tooltip";

interface ToggleProps {
  label: string;
  /** One line under the label explaining what the setting does. */
  description?: ReactNode;
  /** Shown on hover when the explanation is not worth a permanent line. */
  title?: string;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}

/** A settings checkbox with a label and an optional explanation. */
export function Toggle({ label, description, title, checked, disabled = false, onChange }: ToggleProps) {
  const control = (
    <label className="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>
        {label}
        {description && <small>{description}</small>}
      </span>
    </label>
  );
  return title ? <Tooltip content={title}>{control}</Tooltip> : control;
}
