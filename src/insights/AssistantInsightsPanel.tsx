import { useEffect, useState } from "react";
import { assistantInsightReadiness, ASSISTANT_FIRST_MIN_MESSAGES, ASSISTANT_FIRST_MIN_DAYS, ASSISTANT_REFRESH_NEW_MESSAGES, ASSISTANT_REFRESH_DAYS, ASSISTANT_REFRESH_MIN_AFTER_WEEK, type AssistantInsightReadiness } from "@/insights/assistantInsightReadiness";
import {
  analyzeAssistantUsage,listAssistantInsightData,loadAssistantInsightSamples,
  savePersonalPlaybookDraft,setAssistantCandidateStatus,
} from "@/services/assistantInsightsService";
import type {
  AssistantInsightCandidate,AssistantInsightRun,AssistantInsightSample,PersonalPlaybookDraft,
} from "@/insights/assistantInsights";

interface Props {active:boolean;userId:string|null;refreshToken:number;}
type Snapshot={
  candidates:AssistantInsightCandidate[];drafts:PersonalPlaybookDraft[];
  lastRun:AssistantInsightRun|null;
};
const EMPTY:Snapshot={candidates:[],drafts:[],lastRun:null};
const LABELS={workflow:"Personal workflow",adaptation:"Assistant adaptation",goal:"Goal / productivity"} as const;
const KINDS=["workflow","adaptation","goal"] as const;

export function AssistantInsightsPanel({active,userId,refreshToken}:Props) {
  const [snapshot,setSnapshot]=useState<Snapshot>(EMPTY);
  const [loadedFor,setLoadedFor]=useState<string|null>(null);
  const [readiness,setReadiness]=useState<AssistantInsightReadiness|null>(null);
  const [loading,setLoading]=useState(false);
  const [analyzing,setAnalyzing]=useState(false);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [refresh,setRefresh]=useState(0);
  const [editing,setEditing]=useState<{id:string;title:string;steps:string}|null>(null);
  const [evidence,setEvidence]=useState<{id:string;items:AssistantInsightSample[]}|null>(null);

  useEffect(()=>{
    setSnapshot(EMPTY);setLoadedFor(null);setReadiness(null);
    setEvidence(null);setEditing(null);setError(null);setNotice(null);
  },[userId]);
  useEffect(()=>{
    if(!active||!userId)return;
    let cancelled=false;
    setLoading(true);
    void Promise.all([listAssistantInsightData(userId),loadAssistantInsightSamples(userId)]).then(([data,samples])=>{
      if(cancelled)return;
      setSnapshot(data);setReadiness(assistantInsightReadiness(samples,data.lastRun));
      setLoadedFor(userId);setLoading(false);setError(null);
    },reason=>{
      if(cancelled)return;
      setLoading(false);setError(reason instanceof Error?reason.message:"Could not load Assistant Insights.");
    });
    return ()=>{cancelled=true;};
  },[active,userId,refresh,refreshToken]);
  useEffect(()=>{
    if(!active||!userId)return;
    const update=()=>setRefresh(count=>count+1);
    window.addEventListener("focus",update);
    window.addEventListener("online",update);
    return ()=>{window.removeEventListener("focus",update);window.removeEventListener("online",update);};
  },[active,userId]);

  async function analyze() {
    if(!userId||!readiness?.ready||loading||analyzing)return;
    setAnalyzing(true);setError(null);setNotice(null);
    try{
      const result=await analyzeAssistantUsage(userId);
      setNotice(`Reviewed ${result.reviewed} saved user messages. ${result.proposed} supported suggestions identified; existing review decisions are preserved.`);
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
  const showingReadiness=loadedFor===userId?readiness:null;
  const current=showingReadiness?.newSinceLastRun??0;
  const latest=display.lastRun;
  const activityTarget=latest?ASSISTANT_REFRESH_NEW_MESSAGES:ASSISTANT_FIRST_MIN_MESSAGES;
  const activityPercent=Math.min(100,Math.round(current/activityTarget*100));
  const dayCount=latest?Math.min(ASSISTANT_REFRESH_DAYS,Math.floor(showingReadiness?.daysSinceLastRun??0)):(showingReadiness?.activeDays??0);
  const dayTarget=latest?ASSISTANT_REFRESH_DAYS:ASSISTANT_FIRST_MIN_DAYS;
  const dayPercent=Math.min(100,Math.round(dayCount/dayTarget*100));
  return (
    <div className="insights-stack">
      <section className="insights-voice-hero">
        <div className="insights-heading-row">
          <div>
            <p className="insights-eyebrow">Your Assistant</p>
            <h2>Understand how you work</h2>
            <p className="hint">Suggestions for reusable personal workflows, explicit preferences and goals.</p>
          </div>
          <button type="button" className="secondary insights-refresh"
            disabled={loading||analyzing||!showingReadiness?.ready}
            onClick={()=>void analyze()}>
            {analyzing?"Analyzing…":latest?"Refresh insights":"Analyze my Assistant"}
          </button>
        </div>
        <p className="hint">{showingReadiness?.reason??"Loading recent Assistant activity…"}</p>
        {latest&&<p className="insights-hero-meta">Last analysis: {new Date(latest.createdAt).toLocaleDateString()} · {latest.userMessageCount} user messages reviewed</p>}
        <p className="hint">Analyzing sends recent saved user messages to Gemini when you click the button.</p>
      </section>
      <div className="analytics-visual-row insights-visual-row">
        <section className="insights-progress-card">
          <div className="insights-heading-row">
            <div>
              <p className="insights-eyebrow">{latest?"Next Insights refresh":"First Assistant analysis"}</p>
              <h2>{current} / {activityTarget} messages</h2>
            </div>
            <span className="progress-percent">{activityPercent}%</span>
          </div>
          <div className="insights-progress-rail" aria-hidden="true"><span style={{width:`${activityPercent}%`}} /></div>
        </section>
        <section className="insights-progress-card">
          <div className="insights-heading-row">
            <div>
              <p className="insights-eyebrow">{latest?"Time-based refresh":"Active days"}</p>
              <h2>{dayCount} / {dayTarget} days</h2>
            </div>
            <span className="progress-percent">{dayPercent}%</span>
          </div>
          <div className="insights-progress-rail is-secondary" aria-hidden="true"><span style={{width:`${dayPercent}%`}} /></div>
          {latest&&<p className="hint">Time-based refresh requires {ASSISTANT_REFRESH_MIN_AFTER_WEEK} new messages.</p>}
        </section>
      </div>
      {loading&&<p className="hint">Loading saved Assistant suggestions…</p>}
      {error&&<p className="error" role="alert">{error}</p>}
      {notice&&<p className="insights-notice" role="status">{notice}</p>}
      <section className="insights-suggestion-summary">
        <h2>{pending.length} suggestion{pending.length===1?"":"s"} to review</h2>
        <div className="stat-row">
          {KINDS.map(kind=><div className="stat-cell" key={kind}>
            <p className="stat-value">{pending.filter(c=>c.kind===kind).length}</p>
            <p className="stat-label">{LABELS[kind]}</p>
          </div>)}
        </div>
      </section>

      {!pending.length&&!loading&&(
        <p className="hint">No pending Assistant suggestions. Analyze saved conversations to look for grounded patterns.</p>
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
