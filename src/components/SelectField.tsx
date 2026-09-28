export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  label: string;
  value: string;
  options: readonly SelectOption[];
  disabled?: boolean;
  onChange(value: string): void;
}

/** A labelled dropdown for one setting. */
export function SelectField({ label, value, options, disabled = false, onChange }: SelectFieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
