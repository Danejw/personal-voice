import {describe,expect,it} from "vitest";
import {assistantInsightReadiness} from "@/insights/assistantInsightReadiness";
import type {AssistantInsightRun} from "@/insights/assistantInsights";

const add=(days:number,count:number,from=new Date("2026-10-01T09:00:00Z")) =>
  Array.from({length:count},(_,i)=>({createdAt:new Date(from.getTime()+Math.floor(i/count*days)*86_400_000+i*1000).toISOString()}));
const previous:AssistantInsightRun={createdAt:"2026-10-01T09:00:00Z",conversationCount:3,userMessageCount:50,voiceProfile:"This saved profile describes a repeatable, explicit communication style across multiple Assistant sessions.",communicationTips:[]};

describe("Assistant Insights uses a dictation-style readiness cadence",()=>{
  it("requires enough saved messages and multiple active days before the first run",()=>{
    expect(assistantInsightReadiness(add(1,25),null).ready).toBe(false);
    expect(assistantInsightReadiness(add(2,11),null).ready).toBe(false);
    const enough=assistantInsightReadiness(add(3,12),null);
    expect(enough).toMatchObject({ready:true,sampledMessages:12,activeDays:3,newSinceLastRun:12});
  });
  it("refreshes after enough genuinely new user messages",()=>{
    const samples=add(3,30,new Date("2026-10-02T09:00:00Z"));
    const info=assistantInsightReadiness(samples,previous,new Date("2026-10-04T09:00:00Z"));
    expect(info).toMatchObject({ready:true,newSinceLastRun:30});
    expect(assistantInsightReadiness(samples.slice(0,29),previous,new Date("2026-10-04T09:00:00Z")).ready).toBe(false);
  });
  it("allows a time-based refresh after one week and ten new messages",()=>{
    const samples=add(3,10,new Date("2026-10-02T09:00:00Z"));
    expect(assistantInsightReadiness(samples,previous,new Date("2026-10-08T09:00:00Z")).ready).toBe(true);
    expect(assistantInsightReadiness(samples.slice(0,9),previous,new Date("2026-10-08T09:00:00Z")).ready).toBe(false);
  });
  it("does not reuse pre-analysis messages as new data",()=>{
    const samples=[
      ...add(3,29,new Date("2026-09-10T09:00:00Z")),
      ...add(1,4,new Date("2026-10-02T09:00:00Z")),
    ];
    const info=assistantInsightReadiness(samples,previous,new Date("2026-10-20T09:00:00Z"));
    expect(info.newSinceLastRun).toBe(4);
    expect(info.ready).toBe(false);
  });
  it("lets existing users backfill their missing communication profile without 30 new turns",()=>{
    const oldRun={...previous,voiceProfile:null};
    const samples=add(3,20,new Date("2026-09-01T09:00:00Z"));
    const result=assistantInsightReadiness(samples,oldRun,new Date("2026-10-09T09:00:00Z"));
    expect(result).toMatchObject({ready:true,newSinceLastRun:0});
    expect(result.reason).toMatch(/profile/);
    expect(assistantInsightReadiness(samples.slice(0,5),oldRun).ready).toBe(false);
    const withProfile={...previous,voiceProfile:"A sustained communication style profile spanning many observed user messages."};
    expect(assistantInsightReadiness(samples,withProfile,new Date("2026-10-09T09:00:00Z")).ready).toBe(false);
  });
  it("never models success, reanalysis eligibility or duration from Assistant tool calls",()=>{
    const readiness=assistantInsightReadiness([],previous,new Date("2026-10-20T09:00:00Z"));
    expect(readiness).toMatchObject({ready:false,newSinceLastRun:0,sampledMessages:0});
  });
});
