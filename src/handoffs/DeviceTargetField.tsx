import { SelectField } from "@/components/SelectField";
import type { SelectOption } from "@/components/SelectField";
import type { HandoffSnapshot, HandoffStore } from "@/handoffs/HandoffStore";

interface DeviceTargetFieldProps {
  label: string;
  store: HandoffStore;
  snapshot: HandoffSnapshot;
  disabled?: boolean;
  layout?: "row" | "stack";
}

/** Shared target selection for voice handoffs and manually sent clipboard text. */
export function DeviceTargetField({
  label,
  store,
  snapshot,
  disabled = false,
  layout = "row",
}: DeviceTargetFieldProps) {
  const options: readonly SelectOption[] = [
    { value: "", label: "All my other devices" },
    ...snapshot.devices.map((device) => ({
      value: device.id,
      label: `${device.name} (${device.platform})`,
    })),
  ];

  return (
    <SelectField
      label={label}
      value={snapshot.targetDeviceId ?? ""}
      options={options}
      disabled={disabled || snapshot.status !== "synced"}
      layout={layout}
      onChange={(value) => store.selectTarget(value || null)}
    />
  );
}
