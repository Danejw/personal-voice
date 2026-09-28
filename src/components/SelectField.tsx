export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  label: string;
  value: string;
  options: readonly SelectOption[];
  disabled?: boolean;
  /** `stack` puts the label above a full-width control. Default is one row. */
  layout?: "row" | "stack";
  onChange(value: string): void;
}

/** A labelled dropdown for one setting. */
export function SelectField({ label, value, options, disabled = false, layout = "row", onChange }: SelectFieldProps) {
  return (
    <label className={layout === "stack" ? "field stack" : "field"}>
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
