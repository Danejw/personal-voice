/** Phase C Assistant Insights: source-grounded, opt-in and never executable. */
export type AssistantInsightKind = "workflow" | "adaptation" | "goal";
export type AssistantInsightStatus = "pending" | "saved" | "dismissed" | "muted";

export interface AssistantInsightSample {
  messageId: string;
  conversationId: string;
  createdAt: string;
  text: string;
}
export interface AssistantInsightCandidate {
  id: string;
  fingerprint: string;
  kind: AssistantInsightKind;
  title: string;
  reason: string;
  nextStep: string;
  proposedSteps: string[];
  evidenceMessageIds: string[];
  status: AssistantInsightStatus;
  createdAt: string;
}
export interface PersonalPlaybookDraft {
  id: string;
  sourceCandidateId: string;
  title: string;
  steps: string[];
  createdAt: string;
}
export interface AssistantInsightRun {
  createdAt: string;
  userMessageCount: number;
  conversationCount: number;
}
export interface AssistantInsightProposal extends Omit<AssistantInsightCandidate, "id" | "status" | "createdAt"> {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const kinds = ["workflow","adaptation","goal"] as const;
const statuses = ["pending","saved","dismissed","muted"] as const;
const isKind = (value: unknown): value is AssistantInsightKind => kinds.some(k=>k===value);
const isStatus = (value: unknown): value is AssistantInsightStatus => statuses.some(k=>k===value);
const plain = (x:unknown,max:number):string => typeof x==="string" ? x.trim().slice(0,max) : "";
const isUuid = (s:unknown):s is string => typeof s==="string" && UUID.test(s);

export function candidateFingerprint(kind:AssistantInsightKind,title:string):string {
  const slug=title.toLocaleLowerCase().normalize("NFKC").replace(/[^a-z0-9 ]/g," ")
    .replace(/\s+/g," ").trim().replace(/ /g,"_").slice(0,100);
  return `${kind}:${slug||"untitled"}`.slice(0,120);
}

/** Conservative validation: model evidence must cite actual finalized USER message IDs supplied in this analysis. */
export function parseAssistantProposals(raw:unknown,samples:readonly AssistantInsightSample[]):AssistantInsightProposal[] {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("Assistant analysis returned invalid data.");
  const list=(raw as Record<string,unknown>).candidates;
  if(!Array.isArray(list))throw new Error("Assistant analysis returned no valid candidate list.");
  const allowed = new Set(samples.map(s=>s.messageId));
  const unique = new Map<string,AssistantInsightProposal>();
  for(const candidate of list.slice(0,24)) {
    if(!candidate||typeof candidate!=="object"||Array.isArray(candidate))continue;
    const row=candidate as Record<string,unknown>;
    if(!isKind(row.kind))continue;
    const title=plain(row.title,120), reason=plain(row.reason,800), nextStep=plain(row.nextStep,800);
    if(title.length<3||reason.length<10||nextStep.length<5)continue;
    if(!Array.isArray(row.evidenceMessageIds))continue;
    const evidence=[...new Set(row.evidenceMessageIds.filter(isUuid))].filter(id=>allowed.has(id)).slice(0,6);
    if(evidence.length<(row.kind==="workflow"?3:2))continue;
    const proposedSteps=Array.isArray(row.proposedSteps)
      ? row.proposedSteps.map(e=>plain(e,250)).filter(Boolean).slice(0,8):[];
    if(row.kind==="workflow" && proposedSteps.length<2)continue;
    const fingerprint=candidateFingerprint(row.kind,title);
    if(unique.has(fingerprint))continue;
    unique.set(fingerprint,{
      fingerprint,kind:row.kind,title,reason,nextStep,
      evidenceMessageIds:evidence,proposedSteps:row.kind==="workflow"?proposedSteps:[],
    });
    if(unique.size>=12)break;
  }
  return [...unique.values()];
}

export function parseAssistantCandidate(raw:unknown):AssistantInsightCandidate|null {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
  const r=raw as Record<string,unknown>;
  if(!isUuid(r.id)||!isKind(r.kind)||!isStatus(r.status)||
    !Array.isArray(r.evidence_message_ids)||!Array.isArray(r.proposed_steps))return null;
  const evidence=r.evidence_message_ids.filter(isUuid).slice(0,6);
  if(evidence.length<2)return null;
  return {
    id:r.id,fingerprint:plain(r.fingerprint,120),kind:r.kind,
    title:plain(r.title,120),reason:plain(r.reason,800),nextStep:plain(r.next_step,800),
    proposedSteps:r.proposed_steps.map(e=>plain(e,250)).filter(Boolean).slice(0,8),
    evidenceMessageIds:evidence,status:r.status,createdAt:plain(r.created_at,60),
  };
}
export function parsePersonalDraft(raw:unknown):PersonalPlaybookDraft|null {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
  const r=raw as Record<string,unknown>;
  if(!isUuid(r.id)||!isUuid(r.source_candidate_id)||!Array.isArray(r.steps))return null;
  return {
    id:r.id,sourceCandidateId:r.source_candidate_id,
    title:plain(r.title,120),steps:r.steps.map(v=>plain(v,250)).filter(Boolean).slice(0,8),
    createdAt:plain(r.created_at,60),
  };
}
