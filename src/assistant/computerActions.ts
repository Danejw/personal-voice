/**
 * Supervised computer actions.
 * The Live model does not click. A separate Computer Use request may propose a
 * UI step, and this module decides whether that step may run.
 * Shell, delete, install, purchases, and credential entry are never tools.
 *
 * Computer Use docs checked 2026-09-28:
 * https://ai.google.dev/gemini-api/docs/computer-use
 * Model `gemini-3.8-flash`, Interactions API, desktop environment.
 */

export const COMPUTER_USE_MODEL = "gemini-3.8-flash";
export const COMPUTER_STEP_LIMIT = 8;
export const COMPUTER_TIME_LIMIT_MS = 45_000;
export const COMPUTER_TEXT_LIMIT = 500;
export const COMPUTER_WAIT_LIMIT_SECONDS = 2;

export const ALLOWED_APPS = [
  { id: "notepad", label: "Notepad" },
  { id: "calculator", label: "Calculator" },
] as const;

export const ALLOWED_SHORTCUTS = [
  { id: "copy", label: "Copy" },
  { id: "paste", label: "Paste" },
  { id: "select-all", label: "Select all" },
  { id: "undo", label: "Undo" },
  { id: "escape", label: "Escape" },
  { id: "tab", label: "Tab" },
] as const;

export type AllowedAppId = (typeof ALLOWED_APPS)[number]["id"];
export type AllowedShortcutId = (typeof ALLOWED_SHORTCUTS)[number]["id"];
export type RemoteComputerAction =
  | "open_app" | "press_shortcut" | "insert_text"
  | "move_pointer" | "click_pointer" | "double_click_pointer"
  | "right_click_pointer" | "drag_pointer"
  | "start_computer_goal" | "computer_goal_status" | "stop_computer_goal";

export function parseRemotePointer(action: string, argument: string): {
  kind: "move" | "click" | "double_click" | "right_click" | "drag";
  x: number; y: number; endX?: number; endY?: number;
} | null {
  const kinds: Record<string, "move" | "click" | "double_click" | "right_click" | "drag"> = {
    move_pointer: "move", click_pointer: "click", double_click_pointer: "double_click",
    right_click_pointer: "right_click", drag_pointer: "drag",
  };
  const kind = kinds[action];
  if (!kind) return null;
  const pieces = argument.split(",");
  if (pieces.length !== (kind === "drag" ? 4 : 2)) return null;
  if (pieces.some(piece => !/^(0|[1-9][0-9]{0,2})$/.test(piece))) return null;
  const values = pieces.map(Number);
  if (values.some(value => value > 999)) return null;
  return kind === "drag"
    ? { kind, x: values[0]!, y: values[1]!, endX: values[2]!, endY: values[3]! }
    : { kind, x: values[0]!, y: values[1]! };
}

export type SafetyClass = "read" | "low" | "high" | "unsupported";

const UNSUPPORTED = new Set([
  "run_shell",
  "shell",
  "delete_file",
  "delete",
  "install",
  "purchase",
  "submit",
  "send_email",
  "enter_credentials",
  "mouse_down",
  "mouse_up",
  "key_down",
  "key_up",
  "navigate",
]);

/** Names the model must not be given as a generic tool. */
export function isUnsupportedAction(name: string): boolean {
  return UNSUPPORTED.has(name);
}

export function safetyClass(name: string, args: Record<string, unknown> = {}): SafetyClass {
  if (isUnsupportedAction(name)) return "unsupported";
  if (name === "take_screenshot" || name === "list_apps") return "read";
  if (name === "type" && args.press_enter === true) return "high";
  if (name === "press_key" && keyName(args.key) === "enter") return "high";
  if (name === "press_key" && keyName(args.key) === "delete") return "unsupported";
  if (name === "hotkey" && hotkeyHas(args.keys, ["delete", "del"])) return "unsupported";
  if (name === "hotkey" && hotkeyHasEnter(args.keys)) return "high";
  if (name === "open_app" || name === "press_shortcut" || name === "insert_text" || name === "copy_text") return "low";
  if (name === "click" || name === "double_click" || name === "move" || name === "right_click" || name === "scroll" || name === "type" || name === "wait") {
    return "low";
  }
  if (name === "drag" || name === "drag_and_drop") return "high";
  if (name === "press_key" || name === "hotkey") return "low";
  return "unsupported";
}

/** App names only. Shells, scripts, command arguments and URLs are not executable inputs. */
export function validateOpenApp(value: unknown): { ok: true; id: string; label: string } | { ok: false; message: string } {
  if (typeof value !== "string") return { ok: false, message: "Name the application to open." };
  const name = value.trim();
  const mapped = ALLOWED_APPS.find((item) => item.id === name.toLowerCase() || item.label.toLowerCase() === name.toLowerCase());
  if (mapped) return { ok: true, id: mapped.id, label: mapped.label };
  // A returned Start Menu display name can contain spaces, unlike an executable.
  const shortcutName = /^[\p{L}\p{N}][\p{L}\p{N} _().+&'-]{0,119}$/u.test(name);
  const executableName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(name);
  if ((!shortcutName && !executableName) || name.includes("..")) {
    return { ok: false, message: "Provide an installed app name or executable filename, without a path, command, URL, or arguments." };
  }
  const base = name.replace(/\.exe$/i, "").toLowerCase();
  if (["cmd","powershell","pwsh","wscript","cscript","mshta","rundll32","regsvr32","reg","schtasks","wmic","bash","sh","wsl","python","py","node","npm","npx"].includes(base)) {
    return { ok: false, message: "Shells, interpreters and administrative command tools cannot be launched by Assistant." };
  }
  return { ok: true, id: name, label: name };
}

export function validateShortcut(value: unknown): { ok: true; id: AllowedShortcutId; label: string } | { ok: false; message: string } {
  if (typeof value !== "string") return { ok: false, message: "Name the shortcut to press." };
  const id = value.trim().toLocaleLowerCase();
  const shortcut = ALLOWED_SHORTCUTS.find((item) => item.id === id || item.label.toLocaleLowerCase() === id);
  if (!shortcut) return { ok: false, message: "That shortcut is not on the allowlist." };
  return { ok: true, id: shortcut.id, label: shortcut.label };
}

export interface ComputerCall {
  name: string;
  args: Record<string, unknown>;
}

export type StepDecision =
  | { action: "execute"; call: ComputerCall; acknowledgement: boolean }
  | { action: "confirm"; call: ComputerCall; explanation: string }
  | { action: "stop"; message: string };

/**
 * One proposed Computer Use step. Invalid arguments, unsupported actions,
 * a stop, the step cap, and the time cap all refuse before anything runs.
 */
export function planComputerStep(
  call: ComputerCall,
  stepIndex: number,
  startedAt: number,
  now: number,
  stopped: boolean,
  limits: { maxSteps: number; maxDurationMs: number; allowRoutineDrag?: boolean } = { maxSteps: COMPUTER_STEP_LIMIT, maxDurationMs: COMPUTER_TIME_LIMIT_MS },
): StepDecision {
  if (stopped) return { action: "stop", message: "Stopped. Nothing further was done." };
  if (stepIndex >= limits.maxSteps) return { action: "stop", message: `Stopped after ${limits.maxSteps} steps.` };
  if (now - startedAt >= limits.maxDurationMs) return { action: "stop", message: "Stopped because the task ran too long." };
  const safety = readSafety(call.args);
  if (safety.decision === "blocked") {
    return { action: "stop", message: safety.explanation || "Computer Use blocked that action." };
  }
  const validated = validateComputerCall(call);
  if (!validated.ok) return { action: "stop", message: validated.message };
  const kind = safetyClass(call.name, call.args);
  if (kind === "unsupported") return { action: "stop", message: "That action is not available." };
  const routineDrag = limits.allowRoutineDrag === true && (call.name === "drag" || call.name === "drag_and_drop");
  const needsConfirm = (kind === "high" && !routineDrag) || safety.decision === "require_confirmation";
  if (needsConfirm) {
    const explanation = safety.explanation
      || (kind === "high" ? "This can submit or send. Confirm before it runs." : "Computer Use asked for confirmation.");
    return { action: "confirm", call, explanation };
  }
  return { action: "execute", call, acknowledgement: false };
}

export function validateComputerCall(call: ComputerCall): { ok: true } | { ok: false; message: string } {
  const args = call.args;
  if (call.name === "click" || call.name === "double_click" || call.name === "move" || call.name === "scroll" || call.name === "right_click" || call.name === "drag") {
    if (!isCoord(args.x) || !isCoord(args.y)) return { ok: false, message: "The click coordinates were not valid." };
  }
  if (call.name === "drag") {
    if (!isCoord(args.end_x) || !isCoord(args.end_y)) return { ok: false, message: "The drag endpoint was not valid." };
  }
  if (call.name === "drag_and_drop" && !dragEndpoints(args.path)) {
    return { ok: false, message: "The drag path was not valid." };
  }
  if (call.name === "type") {
    if (typeof args.text !== "string" || !args.text.trim()) return { ok: false, message: "Text is required." };
    if (args.text.length > COMPUTER_TEXT_LIMIT) return { ok: false, message: "That text is too long to type." };
  }
  if (call.name === "wait") {
    const seconds = args.seconds === undefined ? 1 : args.seconds;
    if (typeof seconds !== "number" || seconds < 0 || seconds > COMPUTER_WAIT_LIMIT_SECONDS) {
      return { ok: false, message: "The wait was not a short pause." };
    }
  }
  if (call.name === "press_key" && !keyName(args.key)) return { ok: false, message: "That key is not available." };
  if (call.name === "hotkey" && !allowedHotkey(args.keys)) return { ok: false, message: "That shortcut is not on the allowlist." };
  if (call.name === "scroll") {
    const direction = args.direction;
    if (direction !== "up" && direction !== "down" && direction !== "left" && direction !== "right") {
      return { ok: false, message: "The scroll direction was not valid." };
    }
  }
  return { ok: true };
}

/** Trusted mode never inherits the broader "low risk" category from local computer use.
 * Only these two fixed app launches and two navigation keys may skip a desktop tap.
 * The database claim applies exactly the same allowlist.
 */
export function isTrustedRemoteAction(action: string, argument: string): boolean {
  if (action === "open_app") {
    const parsed = validateOpenApp(argument);
    return parsed.ok && (parsed.id === "notepad" || parsed.id === "calculator");
  }
  if (action === "press_shortcut") {
    const parsed = validateShortcut(argument);
    return parsed.ok && (parsed.id === "escape" || parsed.id === "tab");
  }
  return false;
}

/** The other device may run only the typed allowlist, and only when that PC has opted in. */
export function planRemoteComputerAction(
  action: string,
  argument: string,
  platform: string,
  remoteActions: boolean,
): { action: "confirm"; label: string } | { action: "deny"; message: string } {
  if (isUnsupportedAction(action) || (action !== "open_app" && action !== "press_shortcut" && action !== "insert_text" && !action.endsWith("_pointer") && action !== "start_computer_goal" && action !== "computer_goal_status" && action !== "stop_computer_goal")) {
    return { action: "deny", message: "That action is not available." };
  }
  if (platform !== "windows") return { action: "deny", message: "This device can't run desktop actions." };
  if (!remoteActions) return { action: "deny", message: "Remote actions are turned off on this PC." };
  if (action === "start_computer_goal") {
    if (argument !== argument.trim() || argument.length < 3 || argument.length > 1000) return { action: "deny", message: "Provide a goal between 3 and 1000 characters." };
    return { action: "confirm", label: "Start an autonomous Computer Use goal on Windows" };
  }
  if (action === "computer_goal_status" || action === "stop_computer_goal") {
    if (argument !== "current") return { action: "deny", message: "Invalid remote Computer Use session reference." };
    return { action: "confirm", label: action === "computer_goal_status" ? "Check Computer Use progress" : "Stop Computer Use" };
  }
  if (action.endsWith("_pointer")) {
    const pointer = parseRemotePointer(action, argument);
    if (!pointer) return { action: "deny", message: "Invalid bounded pointer coordinates." };
    return { action: "confirm", label: pointer.kind === "drag" ? "Drag the Windows pointer" : `Windows pointer: ${pointer.kind.replace(/_/g, " ")}` };
  }
  if (action === "open_app") {
    const app = validateOpenApp(argument);
    if (!app.ok) return { action: "deny", message: app.message };
    return { action: "confirm", label: `Open ${app.label}` };
  }
  if (action === "press_shortcut") {
    const shortcut = validateShortcut(argument);
    if (!shortcut.ok) return { action: "deny", message: shortcut.message };
    return { action: "confirm", label: `Press ${shortcut.label}` };
  }
  const text = argument.trim();
  if (!text) return { action: "deny", message: "Text is required." };
  if (text.length > COMPUTER_TEXT_LIMIT) return { action: "deny", message: "That text is too long to type." };
  return { action: "confirm", label: "Insert text into the focused app" };
}

/** Request body for one Interactions call. The server sets the tool. The client cannot add shell. */
export function computerUseBody(
  goal: string,
  imageBase64: string | null,
  previousInteractionId: string | null,
  functionResult: { name: string; result: string; acknowledgement: boolean; imageBase64: string | null } | null,
): Record<string, unknown> {
  const tool = {
    type: "computer_use",
    environment: "desktop",
    enable_prompt_injection_detection: true,
    excluded_predefined_functions: ["drag_and_drop", "mouse_down", "mouse_up", "key_down", "key_up", "navigate"],
  };
  if (previousInteractionId && functionResult) {
    return {
      model: COMPUTER_USE_MODEL,
      previous_interaction_id: previousInteractionId,
      tools: [tool],
      input: [{
        type: "function_result",
        name: functionResult.name,
        result: [{ type: "text", text: functionResult.result }],
        ...(functionResult.acknowledgement ? { safety_acknowledgement: true } : {}),
        ...(functionResult.imageBase64
          ? { parts: [{ type: "image", data: functionResult.imageBase64, mime_type: "image/jpeg" }] }
          : {}),
      }],
    };
  }
  const input: unknown[] = [{ type: "text", text: goal }];
  if (imageBase64) input.push({ type: "image", data: imageBase64, mime_type: "image/jpeg" });
  return { model: COMPUTER_USE_MODEL, tools: [tool], input };
}

export interface ParsedInteraction {
  id: string | null;
  call: ComputerCall | null;
  text: string;
}

/** Reads the first function call. Extra calls are ignored so one step is one action. */
export function parseInteraction(body: unknown): ParsedInteraction {
  if (typeof body !== "object" || body === null) return { id: null, call: null, text: "" };
  const record = body as { id?: unknown; steps?: unknown; text?: unknown };
  const id = typeof record.id === "string" ? record.id : null;
  let text = typeof record.text === "string" ? record.text : "";
  if (!Array.isArray(record.steps)) return { id, call: null, text };
  let call: ComputerCall | null = null;
  for (const step of record.steps) {
    if (typeof step !== "object" || step === null) continue;
    const row = step as { type?: unknown; name?: unknown; arguments?: unknown; args?: unknown; content?: unknown };
    if (!text && row.type === "model_output" && Array.isArray(row.content)) {
      text = row.content
        .map((block) => (typeof block === "object" && block && "text" in block && typeof block.text === "string" ? block.text : ""))
        .join(" ")
        .trim();
    }
    if (call || row.type !== "function_call" || typeof row.name !== "string" || !row.name) continue;
    const args = row.arguments ?? row.args;
    if (typeof args !== "object" || args === null || Array.isArray(args)) continue;
    call = { name: row.name, args: args as Record<string, unknown> };
  }
  return { id, call, text };
}

/** Maps a Computer Use key step onto the local allowlist. Null means it must not be sent. */
export function executableShortcut(call: ComputerCall): string | null {
  if (call.name === "press_key") {
    const key = keyName(call.args.key);
    if (key === "escape" || key === "tab" || key === "enter") return key;
    return null;
  }
  if (call.name !== "hotkey") return null;
  const joined = hotkeyKeys(call.args.keys).join("+");
  if (joined === "ctrl+c" || joined === "control+c" || joined === "copy") return "copy";
  if (joined === "ctrl+v" || joined === "control+v" || joined === "paste") return "paste";
  if (joined === "ctrl+a" || joined === "control+a" || joined === "select-all") return "select-all";
  if (joined === "ctrl+z" || joined === "control+z" || joined === "undo") return "undo";
  if (joined === "escape") return "escape";
  if (joined === "tab") return "tab";
  return null;
}

function readSafety(args: Record<string, unknown>): { decision: string; explanation: string } {
  const safety = args.safety_decision;
  if (typeof safety !== "object" || safety === null) return { decision: "", explanation: "" };
  const row = safety as { decision?: unknown; explanation?: unknown };
  return {
    decision: typeof row.decision === "string" ? row.decision : "",
    explanation: typeof row.explanation === "string" ? row.explanation : "",
  };
}


/** Accept Computer Use's bounded drag path, but execute as one atomic start-to-end drag. */
export function dragEndpoints(path: unknown): { x: number; y: number; endX: number; endY: number } | null {
  if (!Array.isArray(path) || path.length < 2 || path.length > 40) return null;
  const points = path.map(point => {
    if (Array.isArray(point) && point.length === 2 && isCoord(point[0]) && isCoord(point[1])) {
      return { x: point[0] as number, y: point[1] as number };
    }
    if (point && typeof point === "object" && !Array.isArray(point)) {
      const value = point as Record<string, unknown>;
      if (isCoord(value.x) && isCoord(value.y)) return { x: value.x as number, y: value.y as number };
    }
    return null;
  });
  if (points.some(point => point === null)) return null;
  const start = points[0]!;
  const end = points[points.length - 1]!;
  return { x: start.x, y: start.y, endX: end.x, endY: end.y };
}

function isCoord(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 999;
}

function keyName(value: unknown): string {
  if (typeof value !== "string") return "";
  const name = value.trim().toLocaleLowerCase();
  if (name === "return") return "enter";
  if (name === "del") return "delete";
  if (name === "enter" || name === "escape" || name === "tab" || name === "delete") return name;
  return "";
}

function hotkeyHasEnter(value: unknown): boolean {
  return hotkeyHas(value, ["enter", "return"]);
}

function hotkeyHas(value: unknown, names: readonly string[]): boolean {
  const keys = hotkeyKeys(value);
  return names.some((name) => keys.includes(name));
}

function allowedHotkey(value: unknown): boolean {
  const keys = hotkeyKeys(value);
  if (!keys.length || hotkeyHasEnter(value) || hotkeyHas(value, ["delete", "del"])) return false;
  const joined = keys.join("+");
  const aliases = new Set(["copy", "paste", "select-all", "undo", "escape", "tab", "ctrl+c", "control+c", "ctrl+v", "control+v", "ctrl+a", "control+a", "ctrl+z", "control+z"]);
  return aliases.has(joined) || ALLOWED_SHORTCUTS.some((item) => item.id === joined);
}

function hotkeyKeys(value: unknown): string[] {
  if (typeof value === "string") return value.split("+").map((part) => part.trim().toLocaleLowerCase()).filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLocaleLowerCase());
}
