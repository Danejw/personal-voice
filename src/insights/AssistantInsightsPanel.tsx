import { useEffect, useState } from "react";
import {
  analyzeAssistantUsage,listAssistantInsightData,loadAssistantInsightSamples,
  savePersonalPlaybookDraft,setAssistantCandidateStatus,
} from "@/services/assistantInsightsService";
import type {
  AssistantInsightCandidate,AssistantInsightRun,AssistantInsightSample,PersonalPlaybookDraft,
} from "@/insights/assistantInsights";

interface Props {active:boolean;userId:string|null;}
type Snapshot={
  candidates:AssistantInsightCandidate[];drafts:PersonalPlaybookDraft[];
  lastRun:AssistantInsightRun|null;
};
const EMPTY:Snapshot={candidates:[],drafts:[],lastRun:null};
const LABELS={workflow:"Personal workflow",adaptation:"Assistant adaptation",goal:"Goal / productivity"} as const;
const KINDS=["workflow","adaptation","goal"] as const;

export function AssistantInsightsPanel({active,userId}:Props) {
  const [snapshot,setSnapshot]=useState<Snapshot>(EMPTY);
  const [loadedFor,setLoadedFor]=useState<string|null>(null);
  const [allowModel,setAllowModel]=useState(false);
  const [loading,setLoading]=useState(false);
  const [analyzing,setAnalyzing]=useState(false);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [refresh,setRefresh]=useState(0);
  const [editing,setEditing]=useState<{id:string;title:string;steps:string}|null>(null);
  const [evidence,setEvidence]=useState<{id:string;items:AssistantInsightSample[]}|null>(null);

  useEffect(()=>{
    setSnapshot(EMPTY);setLoadedFor(null);setAllowModel(false);
    setEvidence(null);setEditing(null);setError(null);setNotice(null);
  },[userId]);
  useEffect(()=>{
    if(!active||!userId)return;
    let cancelled=false;
    setLoading(true);
    void listAssistantInsightData(userId).then(data=>{
      if(cancelled)return;
      setSnapshot(data);setLoadedFor(userId);setLoading(false);setError(null);
    },reason=>{
      if(cancelled)return;
      setLoading(false);setError(reason instanceof Error?reason.message:"Could not load Assistant Insights.");
    });
    return ()=>{cancelled=true;};
  },[active,userId,refresh]);

  async function analyze() {
    if(!userId||!allowModel)return;
    setAnalyzing(true);setError(null);setNotice(null);
    try{
      const result=await analyzeAssistantUsage(userId);
      setNotice(`Reviewed ${result.reviewed} saved user messages. ${result.proposed} supported suggestions identified; existing review decisions are preserved.`);
      setAllowModel(false);
      setRefresh(n=>n+1);
    }catch(e){setError(e instanceof Error?e.message:"Assistant analysis failed.");}
    finally{setAnalyzing(false);}
  }

  async function update(candidate:AssistantInsightCandidate,status:"saved"|"dismissed"|"muted") {
    if(!userId)return;
    setBusy(candidate.id);setError(null);
    try{
      await setAssistantCandidateStatus(userId,candidate.id,status);
      setRefresh(n=>n+1);
      setNotice(status==="saved"?"Saved for your review. No Assistant settings or goals were changed.":status==="muted"?
        "This suggestion will not be proposed again under the same fingerprint.":"Suggestion dismissed.");
    }catch(e){setError(e instanceof Error?e.message:"Could not update the suggestion.");}
    finally{setBusy(null);}
  }

  async function saveWorkflow(candidate:AssistantInsightCandidate) {
    if(!userId||editing?.id!==candidate.id)return;
    const steps=editing.steps.split("\n").map(s=>s.trim()).filter(Boolean);
    setBusy(candidate.id);setError(null);
    try{
      await savePersonalPlaybookDraft(userId,candidate,editing.title,steps);
      setEditing(null);setRefresh(n=>n+1);
      setNotice("Personal Playbook draft saved. It cannot run, schedule actions, or alter system tool playbooks.");
    }catch(e){setError(e instanceof Error?e.message:"Could not save the draft.");}
    finally{setBusy(null);}
  }

  async function showEvidence(candidate:AssistantInsightCandidate) {
    if(!userId)return;
    if(evidence?.id===candidate.id){setEvidence(null);return;}
    setBusy(candidate.id);setError(null);
    try{
      const samples=await loadAssistantInsightSamples(userId);
      setEvidence({id:candidate.id,items:samples.filter(s=>candidate.evidenceMessageIds.includes(s.messageId))});
    }catch(e){setError(e instanceof Error?e.message:"Could not load source messages.");}
    finally{setBusy(null);}
  }

  if(!userId)return <p className="hint">Sign in to review your Assistant usage and suggestions.</p>;
  const display=loadedFor===userId?snapshot:EMPTY;
  const pending=display.candidates.filter(c=>c.status==="pending");
  const saved=display.candidates.filter(c=>c.status==="saved");
  return (
    <div className="insights-stack">
      <section className="insights-voice-hero">
        <div className="insights-heading-row">
          <div>
            <p className="insights-eyebrow">Your Assistant</p>
            <h2>Understand how you work</h2>
            <p className="hint">Suggestions for reusable personal workflows, explicit preferences and goals. Tool performance and reliability remain in Analytics.</p>
          </div>
          <button type="button" className="secondary" onClick={()=>setRefresh(n=>n+1)}
            disabled={loading||analyzing}>Refresh</button>
        </div>
        <p>Assistant conversations are only analyzed when you request it. We sample up to 80 recent finalized user messages from up to 12 saved conversations; the model does not receive tool outputs or Assistant replies.</p>
        <p className="hint">Analysis sends the sampled message text to the configured Gemini service and may incur API costs. Results are suggestions, not facts about your personality or evidence that goals were completed. This is separate from Usage Intelligence.</p>
        <label style={{display:"flex",gap:8,alignItems:"start"}}>
          <input type="checkbox" checked={allowModel} disabled={analyzing}
            onChange={event=>setAllowModel(event.currentTarget.checked)}/>
          I agree to analyze the selected saved Assistant user messages for this run.
        </label>
        <button type="button" disabled={!allowModel||analyzing||loading} onClick={()=>void analyze()}>
          {analyzing?"Analyzing saved messages…":"Analyze my Assistant use"}
        </button>
        {display.lastRun&&<p className="hint">Last analysis: {new Date(display.lastRun.createdAt).toLocaleString()} · {display.lastRun.userMessageCount} user messages · {display.lastRun.conversationCount} conversations.</p>}
      </section>
      {loading&&<p className="hint">Loading saved Assistant suggestions…</p>}
      {error&&<p className="error" role="alert">{error}</p>}
      {notice&&<p className="insights-notice" role="status">{notice}</p>}
      <section className="insights-suggestion-summary">
        <h2>{pending.length} suggestion{pending.length===1?"":"s"} to review</h2>
        <p className="hint">Each suggestion cites saved user messages. Review and edit proposed workflow steps before saving a draft. Nothing runs or changes Assistant preferences automatically.</p>
        <div className="stat-row">
          {KINDS.map(kind=><div className="stat-cell" key={kind}>
            <p className="stat-value">{pending.filter(c=>c.kind===kind).length}</p>
            <p className="stat-label">{LABELS[kind]}</p>
          </div>)}
        </div>
      </section>

      {!pending.length&&!loading&&(
        <p className="hint">No pending Assistant suggestions. Analyze saved conversations to look for grounded patterns. A small sample or no recurring behaviors can legitimately produce no suggestions.</p>
      )}
      {KINDS.map(kind=>{
        const group=pending.filter(c=>c.kind===kind);
        return group.length?<section key={kind} className="insight-candidate-group">
          <h2>{LABELS[kind]}</h2>
          <div className="insight-candidate-grid">
            {group.map(candidate=>(
              <article key={candidate.id} className="insight-candidate-card">
                <h3>{candidate.title}</h3>
                <p className="candidate-reason">{candidate.reason}</p>
                <p className="hint">Evidence: {candidate.evidenceMessageIds.length} saved user messages.</p>
                <button type="button" className="secondary" disabled={busy!==null}
                  onClick={()=>void showEvidence(candidate)}>
                  {evidence?.id===candidate.id?"Hide source messages":"Review source messages"}
                </button>
                {evidence?.id===candidate.id&&(
                  <div className="insights-stack">
                    {evidence.items.length?evidence.items.map(item=><blockquote key={item.messageId}>
                      <p>{item.text}</p>
                      <p className="hint">{new Date(item.createdAt).toLocaleString()} · Saved user message</p>
                    </blockquote>):<p className="hint">Those messages are outside the current bounded sample or no longer available. Re-analyze to refresh source references.</p>}
                  </div>
                )}
                <p><strong>Proposed improvement:</strong> {candidate.nextStep}</p>
                {candidate.kind==="workflow"&&(
                  <div>
                    <h4>Proposed personal workflow</h4>
                    <ol>{candidate.proposedSteps.map((step,i)=><li key={i}>{step}</li>)}</ol>
                    {editing?.id===candidate.id?(
                      <div className="insights-stack">
                        <label>Draft name
                          <input value={editing.title}
                            onChange={event=>setEditing({...editing,title:event.currentTarget.value})}/>
                        </label>
                        <label>Draft steps (one per line, 2–8)
                          <textarea rows={5} value={editing.steps}
                            onChange={event=>setEditing({...editing,steps:event.currentTarget.value})}/>
                        </label>
                        <button type="button" disabled={busy!==null} onClick={()=>void saveWorkflow(candidate)}>Save personal draft</button>
                        <button type="button" className="secondary" onClick={()=>setEditing(null)}>Cancel edit</button>
                      </div>
                    ):<button type="button" disabled={busy!==null}
                      onClick={()=>setEditing({id:candidate.id,title:candidate.title,steps:candidate.proposedSteps.join("\n")})}>Review and save draft</button>}
                  </div>
                )}
                {candidate.kind!=="workflow"&&<button type="button" disabled={busy!==null}
                  onClick={()=>void update(candidate,"saved")}>Save suggestion for review</button>}
                <button type="button" className="secondary" disabled={busy!==null}
                  onClick={()=>void update(candidate,"dismissed")}>Dismiss</button>
                <button type="button" className="secondary" disabled={busy!==null}
                  onClick={()=>void update(candidate,"muted")}>Don't suggest again</button>
              </article>
            ))}
          </div>
        </section>:null;
      })}
      {!!display.drafts.length&&<section className="insight-candidate-group">
        <h2>Personal Playbook drafts ({display.drafts.length})</h2>
        <p className="hint">These are account-owned draft proposals, separate from system tool playbooks. Steps can be reviewed before saving; execution, scheduling, and post-save editing are not yet enabled.</p>
        {display.drafts.map(d=><article className="insight-candidate-card" key={d.id}>
          <h3>{d.title}</h3>
          <ol>{d.steps.map((step,i)=><li key={i}>{step}</li>)}</ol>
        </article>)}
      </section>}
      {!!saved.filter(c=>c.kind!=="workflow").length&&<section className="insight-candidate-group">
        <h2>Saved adaptation and goal suggestions</h2>
        <p className="hint">Saved for later review; preferences, memory and goals have not been changed automatically.</p>
        {saved.filter(c=>c.kind!=="workflow").map(c=><article className="insight-candidate-card" key={c.id}>
          <h3>{c.title}</h3><p>{c.nextStep}</p>
        </article>)}
      </section>}
    </div>
  );
}
