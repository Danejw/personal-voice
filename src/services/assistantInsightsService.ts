import { getSupabase, supabaseConfig } from "@/services/supabase";
import { assistantInsightReadiness } from "@/insights/assistantInsightReadiness";
import {
  parseAssistantCandidate,parseAssistantProposals,parsePersonalDraft,
  type AssistantInsightCandidate,type AssistantInsightProposal,type AssistantInsightRun,
  type AssistantInsightSample,type PersonalPlaybookDraft,
} from "@/insights/assistantInsights";

const MAX_SAMPLES=80;
const unsafeSource=/(?:api[_ -]?key|password|secret|bearer |sk-proj-|authorization:|credit card)/i;
async function accountToken(userId:string):Promise<string> {
  const session=(await getSupabase()?.auth.getSession())?.data.session;
  if(!session?.access_token || session.user.id!==userId)throw new Error("Assistant Insights account changed. Sign in again.");
  return session.access_token;
}
async function rest(userId:string,path:string,init?:RequestInit):Promise<unknown> {
  if(!supabaseConfig)throw new Error("Assistant Insights is not configured.");
  const jwt=await accountToken(userId);
  const response=await fetch(`${supabaseConfig.url}/rest/v1/${path}`,{
    ...init,
    headers:{
      apikey:supabaseConfig.publishableKey,Authorization:`Bearer ${jwt}`,
      ...(init?.headers??{}),
    },
  });
  if(!response.ok)throw new Error(`Assistant Insights storage returned ${response.status}.`);
  return response.status===204||!response.headers.get("content-type")?.includes("json")?null:response.json();
}
const json=(body:unknown,preferences="return=minimal"):RequestInit=>({
  method:"POST",headers:{"Content-Type":"application/json",Prefer:preferences},
  body:JSON.stringify(body),
});
function rows<T>(value:unknown,parse:(value:unknown)=>T|null):T[] {
  return Array.isArray(value)?value.flatMap(v=>{const r=parse(v);return r?[r]:[];}):[];
}
export async function loadAssistantInsightSamples(userId:string):Promise<AssistantInsightSample[]> {
  const raw=await rest(userId,"rpc/list_assistant_insight_samples",json({p_limit:MAX_SAMPLES}));
  if(!Array.isArray(raw))throw new Error("Assistant Insights could not load recent saved user messages.");
  const samples:AssistantInsightSample[]=[];
  for(const value of raw){
    if(!value||typeof value!=="object"||Array.isArray(value))continue;
    const row=value as Record<string,unknown>;
    if(typeof row.message_id!=="string"||typeof row.conversation_id!=="string"||
      typeof row.created_at!=="string"||typeof row.text!=="string"||!row.text.trim())continue;
    if(unsafeSource.test(row.text))continue;
    samples.push({
      messageId:row.message_id,conversationId:row.conversation_id,
      createdAt:row.created_at,text:row.text.trim().slice(0,500),
    });
  }
  return samples;
}

async function modelProposals(userId:string,samples:readonly AssistantInsightSample[]):Promise<AssistantInsightProposal[]> {
  if(!supabaseConfig)throw new Error("Assistant Insights is not configured.");
  const jwt=await accountToken(userId);
  let response:Response;
  try{
    response=await fetch(`${supabaseConfig.url}/functions/v1/assistant-insights`,{
      method:"POST",headers:{
        Authorization:`Bearer ${jwt}`,apikey:supabaseConfig.publishableKey,
        "Content-Type":"application/json",
      },body:JSON.stringify({messages:samples}),
    });
  }catch{throw new Error("Couldn't reach Assistant Insights. Check your connection.");}
  const raw:unknown=await response.json().catch(()=>null);
  if(!response.ok){
    const message=raw&&typeof raw==="object"&&!Array.isArray(raw)&&
      typeof (raw as Record<string,unknown>).error==="string"?(raw as Record<string,string>).error:
      `Assistant Insights analysis failed (${response.status}).`;
    throw new Error(message);
  }
  return parseAssistantProposals(raw,samples);
}

export async function listAssistantInsightData(userId:string):Promise<{
  candidates:AssistantInsightCandidate[]; drafts:PersonalPlaybookDraft[];
  lastRun:AssistantInsightRun|null;
}> {
  const [suggestions,drafts,runs]=await Promise.all([
    rest(userId,"assistant_insight_candidates?select=*&order=created_at.desc&limit=200"),
    rest(userId,"assistant_personal_playbook_drafts?select=*&order=created_at.desc&limit=100"),
    rest(userId,"assistant_insight_runs?select=created_at,user_message_count,conversation_count&order=created_at.desc&limit=1"),
  ]);
  const last=Array.isArray(runs)?runs[0]:null;
  const run=last&&typeof last==="object"&&typeof last.created_at==="string"?
    {createdAt:last.created_at,userMessageCount:Number(last.user_message_count)||0,
      conversationCount:Number(last.conversation_count)||0}:null;
  return {candidates:rows(suggestions,parseAssistantCandidate),drafts:rows(drafts,parsePersonalDraft),lastRun:run};
}

/** A user-triggered, readiness-gated refresh. No background inference or executable playbooks. */
export async function analyzeAssistantUsage(userId:string):Promise<{reviewed:number;proposed:number}> {
  const samples=await loadAssistantInsightSamples(userId);
  const {lastRun}=await listAssistantInsightData(userId);
  const readiness=assistantInsightReadiness(samples,lastRun);
  if(!readiness.ready)throw new Error(readiness.reason);
  const proposals=await modelProposals(userId,samples);
  await accountToken(userId); // Fence against user switching during model inference.
  if(proposals.length){
    const payload=proposals.map(p=>({
      user_id:userId,fingerprint:p.fingerprint,kind:p.kind,title:p.title,reason:p.reason,
      next_step:p.nextStep,proposed_steps:p.proposedSteps,evidence_message_ids:p.evidenceMessageIds,
    }));
    // ON CONFLICT DO NOTHING protects dismissed, saved and muted suggestions on later runs.
    await rest(userId,"assistant_insight_candidates?on_conflict=user_id,fingerprint",
      json(payload,"resolution=ignore-duplicates,return=minimal"));
  }
  await rest(userId,"assistant_insight_runs",json({
    user_id:userId,user_message_count:samples.length,
    conversation_count:new Set(samples.map(s=>s.conversationId)).size,
  }));
  return {reviewed:samples.length,proposed:proposals.length};
}

export async function setAssistantCandidateStatus(
  userId:string,candidateId:string,status:"saved"|"dismissed"|"muted",
):Promise<void>{
  await rest(userId,`assistant_insight_candidates?id=eq.${encodeURIComponent(candidateId)}`,{
    method:"PATCH",headers:{"Content-Type":"application/json",Prefer:"return=minimal"},
    body:JSON.stringify({status,updated_at:new Date().toISOString()}),
  });
}

/** Save a draft, not a runnable playbook. Existing system playbooks remain immutable. */
export async function savePersonalPlaybookDraft(
  userId:string,candidate:AssistantInsightCandidate,title:string,steps:readonly string[],
):Promise<void> {
  if(candidate.kind!=="workflow"||steps.length<2||steps.length>8)throw new Error("A playbook draft needs 2-8 reviewable steps.");
  const safeTitle=title.trim().slice(0,120);
  const safeSteps=steps.map(s=>s.trim().slice(0,250)).filter(Boolean);
  if(safeTitle.length<3||safeSteps.length!==steps.length)throw new Error("Enter a name and clear steps for this draft.");
  await rest(userId,"assistant_personal_playbook_drafts?on_conflict=user_id,source_candidate_id",json({
    user_id:userId,source_candidate_id:candidate.id,title:safeTitle,steps:safeSteps,
  },"resolution=ignore-duplicates,return=minimal"));
  await setAssistantCandidateStatus(userId,candidate.id,"saved");
}
