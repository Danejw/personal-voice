/** Central policy for actions that must remain reviewable even with Auto-run enabled. */
export function requiresExplicitToolApproval(
  name: string,
  serializedArguments: string,
  approveRoutineAccessibility: boolean,
): boolean {
  if (name === "paste_camera_photo" || name === "start_accessibility_watch" ||
      name === "invoke_accessible_control") return true;
  if (name === "uia_control_action") {
    try {
      const { action } = JSON.parse(serializedArguments) as { action?: string };
      return !approveRoutineAccessibility ||
        !["focus","scroll-up","scroll-down","expand","collapse"].includes(action ?? "");
    } catch {
      return true;
    }
  }
  if (name === "accessibility_pattern_action") {
    try {
      const { action } = JSON.parse(serializedArguments) as { action?: string };
      // Navigation and presentation are reversible. Submitting forms or changing
      // values is not guaranteed safe, so those actions always request approval.
      return !approveRoutineAccessibility || ![
        "highlight", "focus", "scroll-up", "scroll-down", "scroll-left",
        "scroll-right", "scroll-into-view", "realize", "expand", "collapse",
        "minimize", "maximize", "restore", "move", "resize",
      ].includes(action ?? "");
    } catch {
      return true;
    }
  }
  return false;
}
