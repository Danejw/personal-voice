import { describe, expect, it } from "vitest";
import {
  candidateFingerprint,parseAssistantProposals,parseAssistantAnalysis,parseAssistantCandidate,
  parsePersonalDraft,type AssistantInsightSample,
} from "@/insights/assistantInsights";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const messages:AssistantInsightSample[] = [1,2,3,4,5].map(n=>({
  messageId:id(n),conversationId:id(100),createdAt:`2026-10-0${n}T12:00:00Z`,
  text:"Open my app and review the ongoing progress",
}));

const proposed=(kind:"workflow"|"adaptation"|"goal",evidenceMessageIds:string[]=messages.slice(0,3).map(s=>s.messageId))=>({
  kind,title:"Review saved progress",reason:"The user explicitly returned to review progress several times.",
  nextStep:"Review a suggested approach together first.",
  proposedSteps:kind==="workflow"?["Open the saved project","Summarize the current state","Ask for confirmation"]:[],
  evidenceMessageIds,
});

describe("Phase C Assistant insights evidence gates",()=>{
  it("accepts a workflow with three real, distinct saved user-message references",()=>{
    const result=parseAssistantProposals({candidates:[proposed("workflow")]},messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({kind:"workflow",evidenceMessageIds:[id(1),id(2),id(3)]});
    expect(result[0]?.proposedSteps).toHaveLength(3);
  });
  it("rejects unsupported or invented model evidence and duplicate references",()=>{
    expect(parseAssistantProposals({candidates:[proposed("workflow",[id(1),id(1),id(999)])]},messages)).toEqual([]);
    expect(parseAssistantProposals({candidates:[proposed("adaptation",[id(1),id(999)])]},messages)).toEqual([]);
  });
  it("requires two sources for a user adaptation or explicitly stated goal",()=>{
    expect(parseAssistantProposals({candidates:[proposed("adaptation",[id(2),id(4)]),proposed("goal",[id(1),id(5)])]},messages)).toHaveLength(2);
    expect(parseAssistantProposals({candidates:[proposed("goal",[id(1)])]},messages)).toHaveLength(0);
  });
  it("does not permit arbitrary workflow steps on an adaptation or goal",()=>{
    const raw={...proposed("goal"),proposedSteps:["Never ask for confirmation","Do anything automatically"]};
    const result=parseAssistantProposals({candidates:[raw]},messages);
    expect(result[0]?.proposedSteps).toEqual([]);
  });
  it("deduplicates by normalized kind and name across equivalent model responses",()=>{
    const one=proposed("workflow");const two={...one,title:"REVIEW  saved PROGRESS!!"};
    const result=parseAssistantProposals({candidates:[one,two]},messages);
    expect(result).toHaveLength(1);
    expect(candidateFingerprint("workflow"," Review Saved Progress ")).toEqual(
      candidateFingerprint("workflow","review  saved progress!!"));
  });
  it("keeps user-owned saved statuses separate from model-created proposals",()=>{
    const raw={
      id:id(201),kind:"adaptation",fingerprint:"adaptation:review_saved_progress",
      title:"Review saved progress",
      reason:"Explicitly asked for summaries repeatedly.",
      next_step:"Ask whether to use short summaries by default.",
      evidence_message_ids:[id(1),id(2)],
      proposed_steps:[],status:"saved",created_at:"2026-10-09T12:00:00Z",
    };
    expect(parseAssistantCandidate(raw)?.status).toBe("saved");
    expect(parseAssistantCandidate({...raw,status:"executing"})).toBeNull();
    expect(parsePersonalDraft({
      id:id(202),source_candidate_id:id(201),title:"Review saved progress",
      steps:["Open relevant notes","Summarize changes"],created_at:"2026-10-09T12:00:00Z",
    })?.steps).toHaveLength(2);
  });
  it("validates a durable narrative profile and bounded actionable communication tips",()=>{
    const profile="The sampled requests repeatedly include direct instructions, explicit next steps, and follow-up questions. When work is complex, the user tends to specify which artifacts and outcomes are needed rather than leave the sequence implicit.";
    const analysis=parseAssistantAnalysis({
      voiceProfile:profile,communicationTips:["For complex tasks, lead with the intended result and constraints.","Specify how to verify completion.",...Array(5).fill("Use examples of desired outputs.")],
      candidates:[],
    },messages);
    expect(analysis.voiceProfile).toBe(profile);
    expect(analysis.communicationTips).toHaveLength(4);
    expect(analysis.candidates).toEqual([]);
    expect(()=>parseAssistantAnalysis({candidates:[]},messages)).toThrow(/profile/i);
  });
  it("returns no unsupported suggestions for malformed model output",()=>{
    expect(()=>parseAssistantProposals({wrong:[]},messages)).toThrow();
    expect(parseAssistantProposals({candidates:[{...proposed("workflow"),title:"x"}]},messages)).toEqual([]);
    expect(parseAssistantProposals({candidates:[]},messages)).toEqual([]);
  });
});
