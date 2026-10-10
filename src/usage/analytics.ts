import type { DictionaryTerm } from "@/sync/personalData";
import {
  OTHER_TARGET_APP,
  USAGE_FEATURES,
  USAGE_TRIGGERS,
  averageWpm,
  cloneCounters,
  emptyCounters,
} from "@/usage/usageEvents";
import type {
  RemoteUsageDay,
  UsageCounters,
  UsageDay,
  UsageFeature,
  UsageTrigger,
} from "@/usage/usageEvents";
import type { TranscriptDestinationId } from "@/voice/transcript/TranscriptDestination";

export const USAGE_PAGE_SIZE = 1000;

export interface UsageDevice {
  id: string;
  name: string;
  /** `windows` or `android` when known from the account device list. */
  platform?: string;
}

export interface DateRange {
  from: string;
  to: string;
}

/** Local calendar day, `YYYY-MM-DD`. */
export function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function shiftDays(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1);
  next.setDate(next.getDate() + delta);
  return localDayKey(next);
}

/** Monday-start week containing `day`. */
export function weekStart(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1);
  const weekday = value.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return shiftDays(day, mondayOffset);
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export interface PanelRanges {
  today: string;
  month: DateRange;
  recent: DateRange;
  weeks: DateRange;
}

/** Ranges the dashboard panels ask for. Recent is 14 local days, not the whole history. */
export function panelRanges(now: Date): PanelRanges {
  const today = localDayKey(now);
  const recentFrom = shiftDays(today, -13);
  const thisWeek = weekStart(today);
  const previousWeek = shiftDays(thisWeek, -7);
  return {
    today,
    month: { from: monthStart(today), to: today },
    recent: { from: recentFrom, to: today },
    weeks: { from: previousWeek, to: today },
  };
}

export interface UsagePageQuery {
  from?: string;
  to?: string;
  offset: number;
  limit: number;
}

/** Reads pages until a short page. A full page means keep going. */
export async function collectUsagePages<T>(
  load: (query: UsagePageQuery) => Promise<T[]>,
  range?: DateRange,
  limit = USAGE_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await load({ from: range?.from, to: range?.to, offset, limit });
    rows.push(...page);
    if (page.length < limit) return rows;
    offset += limit;
  }
}

/** This device's local day replaces the remote row. A missing local day leaves the remote row. */
export function mergeUsageDays(remote: readonly RemoteUsageDay[], local: readonly UsageDay[], deviceId: string): RemoteUsageDay[] {
  const merged = new Map<string, RemoteUsageDay>();
  for (const row of remote) merged.set(`${row.deviceId}|${row.day}`, row);
  for (const row of local) {
    merged.set(`${deviceId}|${row.day}`, {
      deviceId,
      day: row.day,
      epoch: row.epoch,
      revision: row.revision,
      updatedAt: row.updatedAt,
      counters: row.counters,
    });
  }
  return [...merged.values()];
}

export function deviceLabel(deviceId: string, devices: readonly UsageDevice[]): string {
  return devices.find((device) => device.id === deviceId)?.name || "Removed device";
}

export function sumCounters(rows: readonly RemoteUsageDay[]): UsageCounters {
  const total = emptyCounters();
  for (const row of rows) addCounters(total, row.counters);
  return total;
}

function addCounters(total: UsageCounters, part: UsageCounters): void {
  total.dictationStarted += part.dictationStarted;
  total.dictationCompleted += part.dictationCompleted;
  total.dictationFailed += part.dictationFailed;
  total.recoveryUsed += part.recoveryUsed;
  total.outputWords += part.outputWords;
  total.longestWords = Math.max(total.longestWords, part.longestWords);
  total.wpmWords += part.wpmWords;
  total.recordingMs += part.recordingMs;
  total.completionMs += part.completionMs;
  if (part.fastestWpm !== null) total.fastestWpm = total.fastestWpm === null ? part.fastestWpm : Math.max(total.fastestWpm, part.fastestWpm);
  if (part.slowestWpm !== null) total.slowestWpm = total.slowestWpm === null ? part.slowestWpm : Math.min(total.slowestWpm, part.slowestWpm);
  for (const id of Object.keys(total.destinations) as TranscriptDestinationId[]) {
    total.destinations[id] += part.destinations[id] ?? 0;
  }
  for (const id of USAGE_TRIGGERS) total.triggers[id] += part.triggers[id] ?? 0;
  for (const id of USAGE_FEATURES) total.features[id] += part.features[id] ?? 0;
  for (let hour = 0; hour < 24; hour += 1) total.hours[hour] = (total.hours[hour] ?? 0) + (part.hours[hour] ?? 0);
  for (const [term, uses] of Object.entries(part.terms)) total.terms[term] = (total.terms[term] ?? 0) + uses;
  for (const [id, stat] of Object.entries(part.targetApps)) {
    const current = total.targetApps[id] ?? { label: stat.label, count: 0, words: 0 };
    current.count += stat.count;
    current.words += stat.words;
    if (stat.label) current.label = stat.label;
    total.targetApps[id] = current;
  }
}

export function share(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 100);
}

export interface NamedCount {
  id: string;
  label: string;
  count: number;
  share: number;
}

export interface DeviceUsage extends NamedCount {
  words: number;
  lastDay: string | null;
}

export interface TermUsage {
  term: string;
  uses: number;
  lastDay: string | null;
  firstDay: string | null;
}

export interface TargetAppUsage extends NamedCount {
  words: number;
}

export interface DayBar {
  day: string;
  words: number;
  wpm: number | null;
}

export interface PlatformUsage extends NamedCount {
  words: number;
}

export interface AnalyticsModel {
  /** Output words across every synced day in the current epoch. */
  lifetimeWords: number;
  monthWords: number;
  monthDictations: number;
  monthCompletionMs: number;
  monthWpm: number | null;
  todayWpm: number | null;
  weekWpm: number | null;
  fastestWpm: number | null;
  slowestWpm: number | null;
  bars: DayBar[];
  /** Daily word totals for the contribution-style calendar (recent months). */
  heatDays: DayBar[];
  devices: DeviceUsage[];
  mostUsedDevice: DeviceUsage | null;
  platforms: PlatformUsage[];
  destinations: NamedCount[];
  triggers: NamedCount[];
  features: NamedCount[];
  apps: TargetAppUsage[];
  terms: TermUsage[];
  neverUsed: string[];
  activeDays: number;
  streak: number;
  longestStreak: number;
  insights: string[];
}

const DESTINATION_LABELS: Record<TranscriptDestinationId, string> = {
  "active-field": "Active field",
  "voice-note": "Notes",
  "remote-dictation": "Remote Dictation",
};

export const TRIGGER_LABELS: Record<UsageTrigger, string> = {
  "ui-button": "UI button",
  "shortcut-dictate": "Hold to Dictate",
  "shortcut-note": "Note Shortcut",
  "shortcut-handoff": "Handoff Shortcut",
  overlay: "Floating Control",
  "android-floating-mic": "Floating Mic",
};

const FEATURE_LABELS: Record<UsageFeature, string> = {
  selection_captured: "Capture Selection",
  voice_note_created: "Notes",
  handoff_created: "Handoffs",
  history_inserted: "Recent Dictation",
  shared_clipboard: "Shared Clipboard",
};

function completedByDay(rows: readonly RemoteUsageDay[]): Map<string, number> {
  const days = new Map<string, number>();
  for (const row of rows) {
    days.set(row.day, (days.get(row.day) ?? 0) + row.counters.dictationCompleted);
  }
  return days;
}

/** Consecutive local days with a completion, ending today or yesterday. */
export function usageStreak(rows: readonly RemoteUsageDay[], today: string): number {
  const active = completedByDay(rows);
  let cursor = (active.get(today) ?? 0) > 0 ? today : shiftDays(today, -1);
  if ((active.get(cursor) ?? 0) <= 0) return 0;
  let count = 0;
  while ((active.get(cursor) ?? 0) > 0) {
    count += 1;
    cursor = shiftDays(cursor, -1);
  }
  return count;
}

/** Longest run of consecutive local days with at least one completion. */
export function longestUsageStreak(rows: readonly RemoteUsageDay[]): number {
  const active = completedByDay(rows);
  const days = [...active.keys()].filter((day) => (active.get(day) ?? 0) > 0).sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of days) {
    if (previous && day === shiftDays(previous, 1)) run += 1;
    else run = 1;
    if (run > best) best = run;
    previous = day;
  }
  return best;
}

/** Sunday that starts the week containing `day`. */
export function weekStartSunday(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1);
  return shiftDays(day, -value.getDay());
}

/**
 * One cell per day for a GitHub-style calendar. Defaults to 16 weeks ending this week.
 * Words come from every device row for that local day.
 */
export function heatMapDays(
  rows: readonly RemoteUsageDay[],
  today: string,
  weekCount = 16,
): DayBar[] {
  const words = new Map<string, number>();
  for (const row of rows) {
    words.set(row.day, (words.get(row.day) ?? 0) + row.counters.outputWords);
  }
  const end = weekStartSunday(today);
  const start = shiftDays(end, -(weekCount - 1) * 7);
  const last = shiftDays(end, 6);
  const days: DayBar[] = [];
  for (let cursor = start; cursor <= last; cursor = shiftDays(cursor, 1)) {
    const dayWords = cursor <= today ? (words.get(cursor) ?? 0) : 0;
    days.push({ day: cursor, words: cursor <= today ? dayWords : 0, wpm: null });
    if (cursor === last) break;
  }
  return days;
}

function platformLabel(platform: string): string {
  switch (platform) {
    case "windows": return "Windows";
    case "android": return "Android";
    default: return platform;
  }
}

/** Words attributed to Windows vs Android from known account devices. */
export function platformUsage(
  rows: readonly RemoteUsageDay[],
  devices: readonly UsageDevice[],
): PlatformUsage[] {
  const platformByDevice = new Map(devices.map((device) => [device.id, device.platform ?? ""]));
  const byPlatform = new Map<string, number>();
  for (const row of rows) {
    const platform = platformByDevice.get(row.deviceId);
    if (platform !== "windows" && platform !== "android") continue;
    byPlatform.set(platform, (byPlatform.get(platform) ?? 0) + row.counters.outputWords);
  }
  const total = [...byPlatform.values()].reduce((sum, words) => sum + words, 0);
  return (["windows", "android"] as const)
    .map((id) => {
      const words = byPlatform.get(id) ?? 0;
      return { id, label: platformLabel(id), count: words, words, share: share(words, total) };
    })
    .filter((item) => item.words > 0);
}

function hourLabel(hour: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const clock = hour % 12 === 0 ? 12 : hour % 12;
  return `${clock} ${suffix}`;
}

function busiestWindow(hours: readonly number[]): { start: number; count: number } | null {
  let best: { start: number; count: number } | null = null;
  for (let start = 0; start < 24; start += 1) {
    let count = 0;
    for (let offset = 0; offset < 3; offset += 1) count += hours[(start + offset) % 24] ?? 0;
    if (!best || count > best.count) best = { start, count };
  }
  return best && best.count > 0 ? best : null;
}

function weekend(day: string): boolean {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1).getDay();
  return weekday === 0 || weekday === 6;
}

/**
 * Short lines that fall out of the totals. Sparse history returns nothing
 * rather than a guessed sentence.
 */
export function insightsFrom(rows: readonly RemoteUsageDay[], today: string): string[] {
  const lines: string[] = [];
  const total = sumCounters(rows);
  const appEntries = Object.entries(total.targetApps).filter(([id, stat]) => id !== OTHER_TARGET_APP && stat.count > 0);
  const pastes = Object.values(total.targetApps).reduce((sum, stat) => sum + stat.count, 0);
  const namedPastes = appEntries.reduce((sum, [, stat]) => sum + stat.count, 0);
  const topApp = [...appEntries].sort((a, b) => b[1].count - a[1].count)[0];
  if (topApp && namedPastes >= 5 && share(topApp[1].count, pastes) >= 60) {
    lines.push(`Most of your pasted transcripts go into ${topApp[1].label}.`);
  }
  if (total.dictationCompleted < 5) return lines;
  const devices = deviceUsage(rows);
  const topDevice = devices[0];
  if (topDevice && topDevice.share >= 60) {
    lines.push(`You dictate mostly from your ${topDevice.label}.`);
  }
  const triggers = ranked(USAGE_TRIGGERS.map((id) => ({ id, label: TRIGGER_LABELS[id], count: total.triggers[id] })));
  const topTrigger = triggers[0];
  if (topTrigger && topTrigger.share >= 60) {
    lines.push(`You usually start Personal Voice with ${topTrigger.label}.`);
  }
  const window = busiestWindow(total.hours);
  if (window && window.count >= 5) {
    const end = (window.start + 3) % 24;
    lines.push(`You use Personal Voice most between ${hourLabel(window.start)}–${hourLabel(end)}.`);
  }
  let weekdayCount = 0;
  let weekendCount = 0;
  for (const row of rows) {
    const bucket = weekend(row.day) ? "weekend" : "weekday";
    if (bucket === "weekend") weekendCount += row.counters.dictationCompleted;
    else weekdayCount += row.counters.dictationCompleted;
  }
  if (weekdayCount > 0 && weekendCount > 0) {
    const weekdayShare = share(weekdayCount, weekdayCount + weekendCount);
    if (weekdayShare >= 70) lines.push("Most of your dictation happens on weekdays.");
    if (weekdayShare <= 30) lines.push("Most of your dictation happens on weekends.");
  }
  const thisWeekStart = weekStart(today);
  const previousStart = shiftDays(thisWeekStart, -7);
  const thisWeek = sumCounters(rows.filter((row) => row.day >= thisWeekStart && row.day <= today));
  const previous = sumCounters(rows.filter((row) => row.day >= previousStart && row.day < thisWeekStart));
  if (thisWeek.dictationCompleted >= 3 && previous.dictationCompleted >= 3 && previous.outputWords > 0) {
    const delta = Math.round(((thisWeek.outputWords - previous.outputWords) / previous.outputWords) * 100);
    if (delta >= 20) lines.push("You dictated more words this week than last week.");
    if (delta <= -20) lines.push("You dictated fewer words this week than last week.");
  }
  const notesByDevice = new Map<string, number>();
  const fieldByDevice = new Map<string, number>();
  for (const row of rows) {
    notesByDevice.set(row.deviceId, (notesByDevice.get(row.deviceId) ?? 0) + (row.counters.destinations["voice-note"] ?? 0));
    fieldByDevice.set(row.deviceId, (fieldByDevice.get(row.deviceId) ?? 0) + (row.counters.destinations["active-field"] ?? 0));
  }
  const noteTotal = [...notesByDevice.values()].reduce((sum, count) => sum + count, 0);
  const noteLeader = [...notesByDevice.entries()].sort((a, b) => b[1] - a[1])[0];
  const fieldLeader = [...fieldByDevice.entries()].sort((a, b) => b[1] - a[1])[0];
  if (noteLeader && fieldLeader && noteTotal >= 5 && noteLeader[0] !== fieldLeader[0] && share(noteLeader[1], noteTotal) >= 60) {
    lines.push("Notes and active-field dictation come from different devices.");
  }
  if (total.dictationCompleted >= 5 && share(total.recoveryUsed, total.dictationCompleted) >= 10) {
    lines.push(`${share(total.recoveryUsed, total.dictationCompleted)}% of completed dictations needed recovery.`);
  }
  const termLeader = Object.entries(total.terms).sort((a, b) => b[1] - a[1]);
  const first = termLeader[0];
  const second = termLeader[1];
  if (first && first[1] >= 5 && (!second || first[1] >= second[1] * 2)) {
    lines.push(`You use “${first[0]}” more than your other custom terms.`);
  }
  return lines;
}

function ranked(items: { id: string; label: string; count: number }[]): NamedCount[] {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return items
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((item) => ({ ...item, share: share(item.count, total) }));
}

export function deviceUsage(rows: readonly RemoteUsageDay[], devices: readonly UsageDevice[] = []): DeviceUsage[] {
  const byId = new Map<string, { count: number; words: number; lastDay: string | null }>();
  for (const row of rows) {
    const current = byId.get(row.deviceId) ?? { count: 0, words: 0, lastDay: null };
    current.count += row.counters.dictationCompleted;
    current.words += row.counters.outputWords;
    if (!current.lastDay || row.day > current.lastDay) current.lastDay = row.day;
    byId.set(row.deviceId, current);
  }
  const total = [...byId.values()].reduce((sum, item) => sum + item.count, 0);
  return [...byId.entries()]
    .map(([id, item]) => ({
      id,
      label: deviceLabel(id, devices),
      count: item.count,
      words: item.words,
      lastDay: item.lastDay,
      share: share(item.count, total),
    }))
    .filter((item) => item.count > 0 || item.words > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function targetAppUsage(counters: UsageCounters): TargetAppUsage[] {
  const items = Object.entries(counters.targetApps)
    .filter(([, stat]) => stat.count > 0)
    .map(([id, stat]) => ({ id, label: stat.label || id, count: stat.count, words: stat.words }));
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return items
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((item) => ({ ...item, share: share(item.count, total) }));
}

export function termUsage(rows: readonly RemoteUsageDay[], dictionary: readonly DictionaryTerm[]): { used: TermUsage[]; neverUsed: string[] } {
  const uses = new Map<string, { uses: number; firstDay: string | null; lastDay: string | null }>();
  for (const row of rows) {
    for (const [term, count] of Object.entries(row.counters.terms)) {
      const current = uses.get(term) ?? { uses: 0, firstDay: null, lastDay: null };
      current.uses += count;
      if (!current.firstDay || row.day < current.firstDay) current.firstDay = row.day;
      if (!current.lastDay || row.day > current.lastDay) current.lastDay = row.day;
      uses.set(term, current);
    }
  }
  const used: TermUsage[] = [];
  const neverUsed: string[] = [];
  const seen = new Set<string>();
  for (const entry of dictionary) {
    const key = entry.term.toLocaleLowerCase();
    seen.add(key);
    const stat = uses.get(key);
    if (!stat || stat.uses === 0) neverUsed.push(entry.term);
    else used.push({ term: entry.term, uses: stat.uses, firstDay: stat.firstDay, lastDay: stat.lastDay });
  }
  for (const [term, stat] of uses) {
    if (seen.has(term) || stat.uses === 0) continue;
    used.push({ term, uses: stat.uses, firstDay: stat.firstDay, lastDay: stat.lastDay });
  }
  used.sort((a, b) => b.uses - a.uses || a.term.localeCompare(b.term));
  return { used, neverUsed };
}

export function buildAnalytics(input: {
  lifetime: readonly RemoteUsageDay[];
  month: readonly RemoteUsageDay[];
  recent: readonly RemoteUsageDay[];
  weeks: readonly RemoteUsageDay[];
  devices: readonly UsageDevice[];
  dictionary: readonly DictionaryTerm[];
  today: string;
}): AnalyticsModel {
  const month = sumCounters(input.month);
  const todayRows = input.recent.filter((row) => row.day === input.today);
  const weekFrom = weekStart(input.today);
  const weekRows = input.weeks.filter((row) => row.day >= weekFrom && row.day <= input.today);
  const lifetime = sumCounters(input.lifetime);
  const devices = deviceUsage(input.lifetime, input.devices);
  const terms = termUsage(input.lifetime, input.dictionary);
  const recentDays: DayBar[] = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const day = shiftDays(input.today, -offset);
    const counters = sumCounters(input.recent.filter((row) => row.day === day));
    recentDays.push({ day, words: counters.outputWords, wpm: averageWpm(counters.wpmWords, counters.recordingMs) });
  }
  const destinations = ranked((Object.keys(DESTINATION_LABELS) as TranscriptDestinationId[]).map((id) => ({
    id,
    label: DESTINATION_LABELS[id],
    count: lifetime.destinations[id],
  })));
  return {
    lifetimeWords: lifetime.outputWords,
    monthWords: month.outputWords,
    monthDictations: month.dictationCompleted,
    monthCompletionMs: month.completionMs,
    monthWpm: averageWpm(month.wpmWords, month.recordingMs),
    todayWpm: averageWpm(sumCounters(todayRows).wpmWords, sumCounters(todayRows).recordingMs),
    weekWpm: averageWpm(sumCounters(weekRows).wpmWords, sumCounters(weekRows).recordingMs),
    fastestWpm: lifetime.fastestWpm,
    slowestWpm: lifetime.slowestWpm,
    bars: recentDays,
    heatDays: heatMapDays(input.lifetime, input.today),
    devices,
    mostUsedDevice: devices[0] ?? null,
    platforms: platformUsage(input.lifetime, input.devices),
    destinations,
    triggers: ranked(USAGE_TRIGGERS.map((id) => ({ id, label: TRIGGER_LABELS[id], count: lifetime.triggers[id] }))),
    features: ranked(USAGE_FEATURES.map((id) => ({ id, label: FEATURE_LABELS[id], count: lifetime.features[id] }))),
    apps: targetAppUsage(lifetime),
    terms: terms.used,
    neverUsed: terms.neverUsed,
    activeDays: [...completedByDay(input.lifetime).values()].filter((count) => count > 0).length,
    streak: usageStreak(input.lifetime, input.today),
    longestStreak: longestUsageStreak(input.lifetime),
    insights: insightsFrom(input.lifetime, input.today),
  };
}

/** Copies counters so a caller cannot mutate a stored day through the model. */
export function countersSnapshot(counters: UsageCounters): UsageCounters {
  return cloneCounters(counters);
}
