import type { ReactNode } from "react";

interface ToggleProps {
  label: string;
  /** One line under the label explaining what the setting does. */
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}

/** A settings checkbox with a label and an optional explanation. */
export function Toggle({ label, description, checked, disabled = false, onChange }: ToggleProps) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>
        {label}
        {description && <small>{description}</small>}
      </span>
    </label>
  );
}
