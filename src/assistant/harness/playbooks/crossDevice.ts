import { playbookStep, type ToolPlaybook } from "@/assistant/harness/playbooks/types";

export const CROSS_DEVICE: ToolPlaybook = {
  id: "cross_device",
  title: "Choose the right cross-device operation",
  platform: "all",
  useWhen: "User wants to inspect, hand off to, dictate to, or control another paired device.",
  skipWhen: "User action is confined to this device; use local tools instead.",
  steps: [
    playbookStep("Identify remote target", ["list_handoffs", "read_remote_device"],
      "Resolve name when several devices could match; presence can be inspected for a named paired device.",
      "Exact target and relevant device state identified, or ambiguity explained."),
    playbookStep("Observe remotely", ["read_remote_device"],
      "When user asks what other device is showing, what is open, or whether it is online.",
      "Read-only remote state returned."),
    playbookStep("Deliver for later", ["send_handoff"],
      "When user wants text in the other device's handoff inbox.",
      "Handoff delivered to chosen device."),
    playbookStep("Insert remotely now", ["send_remote_dictation"],
      "When user wants supplied text in the other device's current focused field.",
      "Remote insertion reports result."),
    playbookStep("Perform permitted remote desktop action", ["remote_action"],
      "When user requests a supported app launch, shortcut, or text insertion on another Windows device.",
      "Remote device returns action result."),
  ],
  branches: [
    "Read-only awareness uses read_remote_device; never use it to claim you changed the device.",
    "send_handoff is a transferable inbox item; send_remote_dictation types at a remote cursor now.",
    "remote_action supports the existing limited commands; it is not general remote click or shell.",
    "If there are several similarly named targets, resolve the correct device before sending.",
  ],
  recovery: [
    "If the device is offline, report it rather than claiming delivery or silent retry.",
    "If remote field insertion fails, do not substitute handoff without asking: it is a different outcome.",
  ],
  completion: ["Correct device and intended delivery mode confirmed; do not conflate queued, sent, and inserted states."],
};
