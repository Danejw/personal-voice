import { describe, expect, it } from "vitest";
import { assistantUsageFacts } from "@/insights/assistantUsageFacts";
import type { AssistantUsageEvent } from "@/usage/assistantUsage";
const event=(id:string,kind:AssistantUsageEvent["kind"],at:string,deviceId="laptop",modality:AssistantUsageEvent["modality"]="voice"):AssistantUsageEvent=>({
  id,kind,occurredAt:at,localDay:at.slice(0,10),deviceId,modality,
  sessionId:"s",conversationId:null,epoch:1,durationMs:null,endReason:null,
});
describe("Assistant communication profile measured usage facts",()=>{
  it("counts only finalized user turns and does not invent device/time records from conversation samples",()=>{
    const rows=[
      event("1","user_turn","2026-10-06T08:00:00Z"),
      event("2","user_turn","2026-10-06T08:12:00Z","desktop","typed"),
      event("3","assistant_turn","2026-10-06T08:14:00Z"),
      event("4","session_started","2026-10-06T08:00:00Z"),
    ];
    const facts=assistantUsageFacts(rows);
    expect(facts).toMatchObject({turns:2,activeDays:1,voiceTurns:1,typedTurns:1,unknownTurns:0});
    expect(facts.deviceCounts).toHaveLength(2);
    expect(facts.dayCounts.reduce((a,b)=>a+b,0)).toBe(2);
    expect(facts.hourCounts.reduce((a,b)=>a+b,0)).toBe(2);
  });
  it("returns explicit no-data facts without manufacturing averages, devices or goals",()=>{
    const facts=assistantUsageFacts([]);
    expect(facts).toMatchObject({
      turns:0,activeDays:0,peakDay:null,peakHourStart:null,peakDeviceId:null,
      peakDeviceShare:null,voiceTurns:0,typedTurns:0,unknownTurns:0,
    });
    expect(facts.deviceCounts).toEqual([]);
  });
  it("keeps unknown modality separate from voice and typed",()=>{
    const facts=assistantUsageFacts([event("1","user_turn","2026-10-06T08:00:00Z","a",null)]);
    expect(facts).toMatchObject({turns:1,voiceTurns:0,typedTurns:0,unknownTurns:1});
  });
});
