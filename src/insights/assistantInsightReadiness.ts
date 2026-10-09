import type { AssistantInsightRun, AssistantInsightSample } from "@/insights/assistantInsights";

/**
 * Parallel to dictation Insights readiness, with thresholds sized for
 * intentional Assistant turns, not dictations. Only recent saved user
 * messages are sampled; no model inference occurs to compute readiness.
 */
export const ASSISTANT_FIRST_MIN_MESSAGES = 12;
export const ASSISTANT_FIRST_MIN_DAYS = 2;
export const ASSISTANT_REFRESH_NEW_MESSAGES = 30;
export const ASSISTANT_REFRESH_MIN_AFTER_WEEK = 10;
export const ASSISTANT_REFRESH_DAYS = 7;

export interface AssistantInsightReadiness {
  ready: boolean;
  reason: string;
  sampledMessages: number;
  activeDays: number;
  newSinceLastRun: number;
  daysSinceLastRun: number;
}

function day(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

export function assistantInsightReadiness(
  samples: readonly Pick<AssistantInsightSample, "createdAt">[],
  lastRun: AssistantInsightRun | null,
  now = new Date(),
): AssistantInsightReadiness {
  const sampledMessages=samples.length;
  const activeDays=new Set(samples.map(s=>day(s.createdAt)).filter(Boolean)).size;
  const priorAt=lastRun ? Date.parse(lastRun.createdAt) : NaN;
  const newSinceLastRun=lastRun ? samples.filter(s=>{
    const time=Date.parse(s.createdAt);
    return Number.isFinite(time) && Number.isFinite(priorAt) && time>priorAt;
  }).length : sampledMessages;
  const elapsed=lastRun ? (now.getTime()-Date.parse(lastRun.createdAt)) / 86_400_000 : 0;
  const daysSinceLastRun=Number.isFinite(elapsed)?Math.max(0,elapsed):0;
  if(!lastRun){
    const ready=sampledMessages>=ASSISTANT_FIRST_MIN_MESSAGES&&activeDays>=ASSISTANT_FIRST_MIN_DAYS;
    return {
      ready,sampledMessages,activeDays,newSinceLastRun,daysSinceLastRun,
      reason:ready ? "Ready to analyze your recent Assistant conversations." :
        sampledMessages<ASSISTANT_FIRST_MIN_MESSAGES
          ? `First insights after ${ASSISTANT_FIRST_MIN_MESSAGES} saved messages across ${ASSISTANT_FIRST_MIN_DAYS} active days.`
          : `Use your Assistant across at least ${ASSISTANT_FIRST_MIN_DAYS} active days.`,
    };
  }
  const ready=newSinceLastRun>=ASSISTANT_REFRESH_NEW_MESSAGES ||
    (daysSinceLastRun>=ASSISTANT_REFRESH_DAYS&&newSinceLastRun>=ASSISTANT_REFRESH_MIN_AFTER_WEEK);
  return {
    ready,sampledMessages,activeDays,newSinceLastRun,daysSinceLastRun,
    reason:ready ? "New Assistant activity is ready to analyze." :
      `Next refresh after ${ASSISTANT_REFRESH_NEW_MESSAGES} new messages, or ${ASSISTANT_REFRESH_DAYS} days with at least ${ASSISTANT_REFRESH_MIN_AFTER_WEEK} new messages.`,
  };
}
