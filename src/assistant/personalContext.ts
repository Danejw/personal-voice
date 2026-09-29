import {
  deviceUsage,
  monthStart,
  share,
  shiftDays,
  sumCounters,
  TRIGGER_LABELS,
} from "@/usage/analytics";
import type { UsageDevice } from "@/usage/analytics";
import { averageWpm, OTHER_TARGET_APP } from "@/usage/usageEvents";
import type { RemoteUsageDay, UsageTrigger } from "@/usage/usageEvents";

/** Completed dictations before a device share is stated. */
export const PROFILE_MIN_DICTATIONS = 8;
/** Share, in percent, before a leader is called the usual one. */
export const PROFILE_MIN_SHARE = 60;
/** Recorded starts before a trigger is called the most-used. */
export const PROFILE_MIN_TRIGGER_STARTS = 8;
/** Named pastes before a target app is called frequent. */
export const PROFILE_MIN_PASTES = 5;
/** Uses before a dictionary term is called most-used. */
export const PROFILE_MIN_TERM_USES = 5;
/** Extra terms listed beside the leader. */
export const PROFILE_TERM_FLOOR = 3;
export const PROFILE_TERM_LIMIT = 3;
/** Measured words and recording time before a pace is stated. */
export const PROFILE_MIN_WPM_WORDS = 40;
export const PROFILE_MIN_WPM_MS = 60_000;
/** Days after the newest usage row before analytics are too old to quote. */
export const PROFILE_STALE_DAYS = 45;
export const PROFILE_FACT_LIMIT = 6;
export const PERSONAL_CONTEXT_LIMIT = 2_000;

export interface ProfileFact {
  id: "device" | "trigger" | "target-app" | "terms" | "wpm";
  text: string;
}

export interface PersonalContextInput {
  deviceName: string;
  platform: string;
  profileEnabled: boolean;
  facts: readonly ProfileFact[];
}

/** Facts for the month containing `today`. Sparse or old rows produce none. */
export function profileFacts(
  rows: readonly RemoteUsageDay[],
  devices: readonly UsageDevice[],
  today: string,
): ProfileFact[] {
  const newest = rows.reduce((max, row) => (row.day > max ? row.day : max), "");
  if (!newest || today > shiftDays(newest, PROFILE_STALE_DAYS)) return [];
  const monthFrom = monthStart(today);
  const current = rows.filter((row) => row.day >= monthFrom && row.day <= today);
  if (!current.length) return [];
  const facts: ProfileFact[] = [];
  const device = deviceFact(current, devices);
  const trigger = triggerFact(current);
  const app = targetAppFact(current);
  const terms = termsFact(current);
  const pace = wpmFact(current);
  for (const fact of [device, trigger, app, terms, pace]) {
    if (fact) facts.push(fact);
    if (facts.length >= PROFILE_FACT_LIMIT) break;
  }
  return facts;
}

/** Lines Assistant may see. Disabled analytics are named as off, not omitted in silence. */
export function personalContextBody(input: PersonalContextInput): string {
  const name = input.deviceName.trim() || "This device";
  const platform = platformLabel(input.platform);
  const lines = [`This device is ${name} on ${platform}.`];
  if (!input.profileEnabled) {
    lines.push(
      "Analytics profile is turned off. Do not claim dictation shares, triggers, target apps, dictionary terms, or words per minute.",
    );
  } else if (input.facts.length === 0) {
    lines.push(
      "No analytics facts are available. Do not guess dictation shares, triggers, target apps, dictionary ranks, or pace.",
    );
  } else {
    for (const fact of input.facts.slice(0, PROFILE_FACT_LIMIT)) lines.push(fact.text);
  }
  return lines.join("\n");
}

/** One note for the Live session. Longer text is clipped. */
export function personalContextNote(body: string): string {
  const note = `Personal context for this session. Answer workflow questions only from these lines. Do not invent profile facts that are not written here.\n${body.trim()}`;
  if (note.length <= PERSONAL_CONTEXT_LIMIT) return note;
  return `${note.slice(0, PERSONAL_CONTEXT_LIMIT - 1)}…`;
}

function deviceFact(rows: readonly RemoteUsageDay[], devices: readonly UsageDevice[]): ProfileFact | null {
  const total = sumCounters(rows).dictationCompleted;
  if (total < PROFILE_MIN_DICTATIONS) return null;
  const [leader] = deviceUsage(rows, devices);
  if (!leader || leader.share < PROFILE_MIN_SHARE || leader.label === "Removed device") return null;
  return {
    id: "device",
    text: `${leader.label} accounts for ${leader.share}% of dictations this month (${leader.count} of ${total}).`,
  };
}

function triggerFact(rows: readonly RemoteUsageDay[]): ProfileFact | null {
  const triggers = sumCounters(rows).triggers;
  const ranked = (Object.keys(triggers) as UsageTrigger[])
    .map((id) => ({ id, label: TRIGGER_LABELS[id], count: triggers[id] ?? 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const leader = ranked[0];
  const total = ranked.reduce((sum, item) => sum + item.count, 0);
  if (!leader || total < PROFILE_MIN_TRIGGER_STARTS || share(leader.count, total) < PROFILE_MIN_SHARE) return null;
  return {
    id: "trigger",
    text: `${leader.label} is the most-used trigger this month (${share(leader.count, total)}% of starts).`,
  };
}

function targetAppFact(rows: readonly RemoteUsageDay[]): ProfileFact | null {
  const apps = sumCounters(rows).targetApps;
  const named = Object.entries(apps).filter(([id, stat]) => id !== OTHER_TARGET_APP && stat.count > 0);
  const pastes = Object.values(apps).reduce((sum, stat) => sum + stat.count, 0);
  const namedPastes = named.reduce((sum, [, stat]) => sum + stat.count, 0);
  const leader = [...named].sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label))[0];
  if (!leader || namedPastes < PROFILE_MIN_PASTES || share(leader[1].count, pastes) < PROFILE_MIN_SHARE) return null;
  return {
    id: "target-app",
    text: `${leader[1].label} is a frequent dictation target this month (${leader[1].count} pastes).`,
  };
}

function termsFact(rows: readonly RemoteUsageDay[]): ProfileFact | null {
  const ranked = Object.entries(sumCounters(rows).terms)
    .filter(([term, uses]) => term.trim().length > 0 && uses >= PROFILE_TERM_FLOOR)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, PROFILE_TERM_LIMIT);
  const leader = ranked[0];
  if (!leader || leader[1] < PROFILE_MIN_TERM_USES) return null;
  const listed = ranked.filter((entry, index) => index === 0 || entry[1] >= PROFILE_TERM_FLOOR);
  const text = listed.length === 1
    ? `Most-used dictionary term this month is ${clipTerm(listed[0]?.[0] ?? "")} (${listed[0]?.[1] ?? 0} uses).`
    : `Most-used dictionary terms this month are ${listed.map(([term, uses]) => `${clipTerm(term)} (${uses})`).join(", ")}.`;
  return { id: "terms", text };
}

function wpmFact(rows: readonly RemoteUsageDay[]): ProfileFact | null {
  const total = sumCounters(rows);
  if (total.wpmWords < PROFILE_MIN_WPM_WORDS || total.recordingMs < PROFILE_MIN_WPM_MS) return null;
  const pace = averageWpm(total.wpmWords, total.recordingMs);
  if (pace === null || !Number.isFinite(pace)) return null;
  return {
    id: "wpm",
    text: `Average pace this month is ${Math.round(pace)} words per minute, from measured dictations.`,
  };
}

function clipTerm(term: string): string {
  const trimmed = term.trim();
  return trimmed.length <= 40 ? trimmed : `${trimmed.slice(0, 39)}…`;
}

function platformLabel(platform: string): string {
  if (platform === "windows") return "Windows";
  if (platform === "android") return "Android";
  return platform.trim() || "Unknown";
}
