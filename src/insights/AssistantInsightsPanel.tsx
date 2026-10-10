import { useEffect, useState } from "react";
import { assistantUsageApi } from "@/services/assistantUsageService";
import { assistantToolMetricsApi } from "@/services/assistantToolMetricsService";
import { assistantUsageFacts } from "@/insights/assistantUsageFacts";
import { formatHour } from "@/insights/insights";
import { localUsageDay, type AssistantUsageEvent } from "@/usage/assistantUsage";
import type { AssistantToolAttempt } from "@/usage/assistantToolMetrics";
import { DeviceSplitBar, HorizontalShareBars } from "@/usage/HorizontalShareBars";
import { assistantInsightReadiness, ASSISTANT_FIRST_MIN_MESSAGES, ASSISTANT_FIRST_MIN_DAYS, ASSISTANT_REFRESH_NEW_MESSAGES, ASSISTANT_REFRESH_DAYS, ASSISTANT_REFRESH_MIN_AFTER_WEEK, type AssistantInsightReadiness } from "@/insights/assistantInsightReadiness";
import {
  analyzeAssistantUsage,listAssistantInsightData,loadAssistantInsightSamples,
  savePersonalPlaybookDraft,setAssistantCandidateStatus,
} from "@/services/assistantInsightsService";
import type {
  AssistantInsightCandidate,AssistantInsightRun,AssistantInsightSample,PersonalPlaybookDraft,
} from "@/insights/assistantInsights";

interface Props {
  active:boolean; userId:string|null; refreshToken:number;
  usageEpoch:number;
  devices:readonly {id:string;name:string;platform:string}[];
  view:"profile"|"suggestions";
  onPendingChange:(userId:string,count:number)=>void;
  onOpenSuggestions:()=>void;
}
type Snapshot={
  candidates:AssistantInsightCandidate[];drafts:PersonalPlaybookDraft[];
  lastRun:AssistantInsightRun|null;
};
const EMPTY:Snapshot={candidates:[],drafts:[],lastRun:null};
const LABELS={workflow:"Personal workflow",adaptation:"Assistant adaptation",goal:"Goal / productivity"} as const;
const KINDS=["workflow","adaptation","goal"] as const;

export function AssistantInsightsPanel({active,userId,refreshToken,view,usageEpoch,devices,onPendingChange,onOpenSuggestions}:Props) {
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
  const [usageRows,setUsageRows]=useState<{key:string;events:AssistantUsageEvent[];tools:AssistantToolAttempt[]}|null>(null);
  const [usageError,setUsageError]=useState<string|null>(null);

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

  const usageKey=`${userId??""}:${usageEpoch}`;
  useEffect(()=>{
    setUsageRows(null);
    setUsageError(null);
  },[userId,usageEpoch]);
  useEffect(()=>{
    if(!active||!userId||view!=="profile")return;
    let cancelled=false;
    const now=new Date();
    const fromDay=localUsageDay(new Date(now.getFullYear(),now.getMonth(),now.getDate()-29));
    void Promise.allSettled([
      assistantUsageApi.list(usageEpoch,userId),
      assistantToolMetricsApi.list(usageEpoch,userId,fromDay),
    ]).then(([turns,tools])=>{
      if(cancelled)return;
      setUsageRows({
        key:`${userId}:${usageEpoch}`,
        events:turns.status==="fulfilled"?turns.value:[],
        tools:tools.status==="fulfilled"?tools.value:[],
      });
      setUsageError(turns.status==="rejected"
        ?"Assistant activity could not be loaded. Check usage tracking and the Phase A migration."
        :tools.status==="rejected"
          ?"Tool activity could not be loaded. Device and time metrics remain available.":null);
    });
    return ()=>{cancelled=true;};
  },[active,userId,usageEpoch,view,refresh,refreshToken]);

  useEffect(()=>{
    if(userId&&loadedFor===userId) onPendingChange(userId,snapshot.candidates.filter(c=>c.status==="pending").length);
  },[userId,loadedFor,snapshot.candidates,onPendingChange]);

  async function analyze() {
    if(!userId||!readiness?.ready||loading||analyzing)return;
    setAnalyzing(true);setError(null);setNotice(null);
    try{
      const result=await analyzeAssistantUsage(userId);
      setNotice(`Reviewed ${result.reviewed} saved user messages. ${result.proposed} supported suggestions identified; existing review decisions are preserved.`);
      setRefresh(n=>n+1);
      if(result.proposed>0)onOpenSuggestions();
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
  const measured=usageRows?.key===usageKey?usageRows:null;
  const fromDay=localUsageDay(new Date(new Date().getFullYear(),new Date().getMonth(),new Date().getDate()-29));
  const recentEvents=measured?.events.filter(event=>event.localDay>=fromDay)??[];
  const facts=assistantUsageFacts(recentEvents);
  const deviceNames=new Map(devices.map(device=>[device.id,device.name]));
  const knownDevices=facts.deviceCounts.map(device=>({
    id:device.deviceId,label:deviceNames.get(device.deviceId)??"Unknown device",
    count:device.count,share:Math.round(device.count/Math.max(1,facts.turns)*100),
  }));
  const weekdayNames=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const weekdayRows=facts.dayCounts.map((count,index)=>({
    id:weekdayNames[index]??String(index),label:weekdayNames[index]??String(index),
    count,
  })).filter(row=>row.count>0).sort((a,b)=>b.count-a.count).map(row=>({
    id:row.id,label:row.label,share:Math.round(row.count/Math.max(1,facts.turns)*100),
    detail:row.count.toLocaleString(),
  }));
  const timeRows=Array.from({length:8},(_,index)=>{
    const start=index*3;
    const count=(facts.hourCounts[start]??0)+(facts.hourCounts[start+1]??0)+(facts.hourCounts[start+2]??0);
    return {start,count};
  }).filter(row=>row.count>0).sort((a,b)=>b.count-a.count).map(row=>({
    id:String(row.start),label:`${formatHour(row.start)}–${formatHour((row.start+3)%24)}`,
    share:Math.round(row.count/Math.max(1,facts.turns)*100),
    detail:row.count.toLocaleString(),
  }));
  const modalityRows=[
    {id:"voice",label:"Voice",count:facts.voiceTurns},
    {id:"typed",label:"Typed",count:facts.typedTurns},
    {id:"unknown",label:"Unclassified",count:facts.unknownTurns},
  ].filter(row=>row.count>0).map(row=>({
    ...row,share:Math.round(row.count/Math.max(1,facts.turns)*100),detail:row.count.toLocaleString(),
  }));
  const toolMap=new Map<string,number>();
  for(const attempt of measured?.tools??[]){
    if(attempt.localDay<fromDay)continue;
    const family=attempt.family;
    toolMap.set(family,(toolMap.get(family)??0)+1);
  }
  const toolTotal=[...toolMap.values()].reduce((sum,count)=>sum+count,0);
  const toolRows=[...toolMap].map(([id,count])=>({
    id,label:id.replace(/_/g," "),share:Math.round(count/Math.max(1,toolTotal)*100),
    detail:count.toLocaleString(),count,
  })).sort((a,b)=>b.count-a.count).slice(0,5);

  if(view==="profile")return (
    <div className="insights-stack">
      <section className="insights-voice-hero">
        <div className="insights-heading-row">
          <div>
            <p className="insights-eyebrow">Your Assistant communication profile</p>
            <p className="insights-hero-meta">
              {latest
                ? `Based on ${latest.userMessageCount.toLocaleString()} saved user messages across ${latest.conversationCount} conversations`
                : "A communication-style profile appears after enough saved Assistant conversations accumulate."}
            </p>
          </div>
          <button type="button" className="secondary insights-refresh"
            disabled={loading||analyzing||!showingReadiness?.ready}
            onClick={()=>void analyze()}>
            {analyzing?"Analyzing…":latest&&!latest.voiceProfile?"Generate my profile":latest?"Refresh insights":"Analyze my Assistant"}
          </button>
        </div>
        {latest?.voiceProfile?(
          <p className="voice-profile">{latest.voiceProfile}</p>
        ): null}
        {!showingReadiness?.ready&&latest&&<p className="insights-next-refresh">{showingReadiness?.reason}</p>}
        {!!pending.length&&<button type="button" className="secondary"
          onClick={onOpenSuggestions}>Review {pending.length} suggestion{pending.length===1?"":"s"}</button>}
        {!!latest?.communicationTips.length&&(
          <div className="assistant-communication-guidance">
            <h3>Communicating effectively with your Assistant</h3>
            <ul>{latest.communicationTips.map((tip,index)=><li key={index}>{tip}</li>)}</ul>
          </div>
        )}
        {error&&<p className="error" role="alert">{error}</p>}
        {notice&&<p className="insights-notice" role="status">{notice}</p>}
      </section>

      <section aria-label="Measured Assistant usage, last 30 days">
        <p className="insights-eyebrow">Assistant usage · Last 30 days</p>
        {facts.turns>0?(
          <>
            <div className="stat-row insights-stat-row">
              <div className="stat-cell">
                <p className="stat-value">{facts.peakDay??"–"}</p>
                <p className="stat-label">Peak day</p>
              </div>
              <div className="stat-cell">
                <p className="stat-value">{facts.peakHourStart===null?"–":`${formatHour(facts.peakHourStart)}–${formatHour(facts.peakHourEnd)}`}</p>
                <p className="stat-label">Peak time</p>
              </div>
              <div className="stat-cell">
                <p className="stat-value">{facts.peakDeviceId?deviceNames.get(facts.peakDeviceId)??"Unknown device":"–"}</p>
                <p className="stat-label">{facts.peakDeviceShare===null?"Peak device":`${facts.peakDeviceShare}% during peak time`}</p>
              </div>
              <div className="stat-cell">
                <p className="stat-value">{facts.turns.toLocaleString()}</p>
                <p className="stat-label">Assistant requests</p>
              </div>
              <div className="stat-cell">
                <p className="stat-value">{facts.turns?Math.round(facts.voiceTurns/facts.turns*100)+"%":"–"}</p>
                <p className="stat-label">Voice interactions</p>
              </div>
            </div>
            <div className="analytics-visual-row insights-visual-row">
              <HorizontalShareBars headingId="assistant-insights-days" title="When you use the Assistant"
                items={weekdayRows} empty="No weekday activity measured yet."/>
              <div className="analytics-split-stack">
                <DeviceSplitBar devices={knownDevices} headingId="assistant-insights-devices" unitLabel="Assistant requests"/>
                <HorizontalShareBars headingId="assistant-insights-modes" title="Voice vs typed"
                  items={modalityRows} empty="No input modes have been classified yet."/>
              </div>
            </div>
            <div className="analytics-visual-row insights-visual-row">
              <HorizontalShareBars headingId="assistant-insights-hours" title="Time of day"
                items={timeRows} empty="No time distribution measured yet."/>
              <HorizontalShareBars headingId="assistant-insights-tools" title="Tool activity"
                items={toolRows} empty="No Assistant tool categories measured in this period."/>
            </div>
            <p className="hint">Device and interaction data come from measured Assistant events. Time of day is shown in this device's time zone. Application targets are not collected for Assistant interactions.</p>
          </>
        ):(
          <p className="hint">
            {measured
              ?"No measured Assistant interactions in the last 30 days."
              :"Loading measured Assistant activity…"}
          </p>
        )}
        {usageError&&<p className="hint">{usageError}</p>}
      </section>
      <div className="analytics-visual-row insights-visual-row">
        <section className="insights-progress-card">
          <div className="insights-heading-row">
            <div>
              <p className="insights-eyebrow">{latest?"Next insights refresh":"First Assistant analysis"}</p>
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
          {latest&&<p className="hint">Refresh after {ASSISTANT_REFRESH_MIN_AFTER_WEEK} new messages and 7 days.</p>}
        </section>
      </div>
    </div>
  );

  // Dictation and Assistant recommendations share the same Suggestions tab,
  // card layout, buttons and review model. They keep distinct storage/actions.
  return (
    <div className="insights-stack">
      {loading&&<p className="hint">Loading Assistant suggestions…</p>}
      {error&&<p className="error" role="alert">{error}</p>}
      {notice&&<p className="insights-notice" role="status">{notice}</p>}
      {KINDS.map(kind=>{
        const group=pending.filter(candidate=>candidate.kind===kind);
        if(!group.length)return null;
        const maximum=Math.max(1,...group.map(candidate=>candidate.evidenceMessageIds.length));
        return <section key={kind} className="insight-candidate-group"
          aria-labelledby={`assistant-${kind}-heading`}>
          <div className="insight-group-heading">
            <h2 id={`assistant-${kind}-heading`}>Assistant · {LABELS[kind]}</h2>
            <span>{group.length}</span>
          </div>
          <div className="insight-candidate-grid">
            {group.map(candidate=>(
              <article key={candidate.id} className="insight-candidate-card">
                <div className="insights-heading-row">
                  <div>
                    <p className="candidate-kind">Assistant · {LABELS[candidate.kind]}</p>
                    <h3>{candidate.title}</h3>
                  </div>
                </div>
                <div className="candidate-evidence">
                  <div className="candidate-evidence-head">
                    <span>{candidate.evidenceMessageIds.length} saved messages</span>
                    <span>evidence</span>
                  </div>
                  <div className="candidate-evidence-rail" aria-hidden="true">
                    <span style={{width:`${Math.max(10,Math.round(candidate.evidenceMessageIds.length/maximum*100))}%`}} />
                  </div>
                </div>
                <p className="candidate-reason">{candidate.reason}</p>
                <details className="candidate-details">
                  <summary>Suggested improvement</summary>
                  <p>{candidate.nextStep}</p>
                  {candidate.kind==="workflow"&&<ol className="insights-suggested-steps">
                    {candidate.proposedSteps.map((step,i)=><li key={i}>{step}</li>)}
                  </ol>}
                </details>
                <details className="candidate-details">
                  <summary>Review source messages</summary>
                  <div className="insights-suggestion-disclosure">
                    <button type="button" className="secondary"
                      disabled={busy!==null} onClick={()=>void showEvidence(candidate)}>
                      {evidence?.id===candidate.id?"Hide messages":"Load saved messages"}
                    </button>
                    {evidence?.id===candidate.id&&(
                      evidence.items.length?evidence.items.map(item=><blockquote key={item.messageId}>
                        <p>{item.text}</p>
                        <span className="candidate-evidence-head">{new Date(item.createdAt).toLocaleString()}</span>
                      </blockquote>):<p className="candidate-reason">
                        Source messages are no longer within the recent sample or are unavailable.
                      </p>
                    )}
                  </div>
                </details>
                {editing?.id===candidate.id&&<div className="insights-draft-editor">
                  <label>Draft name
                    <input value={editing.title}
                      onChange={event=>setEditing({...editing,title:event.currentTarget.value})}/>
                  </label>
                  <label>Draft steps (one per line, 2–8)
                    <textarea rows={5} value={editing.steps}
                      onChange={event=>setEditing({...editing,steps:event.currentTarget.value})}/>
                  </label>
                  <div className="candidate-actions">
                    <button type="button" className="record" disabled={busy!==null}
                      onClick={()=>void saveWorkflow(candidate)}>{busy===candidate.id?"Saving…":"Save draft"}</button>
                    <button type="button" className="secondary" disabled={busy!==null}
                      onClick={()=>setEditing(null)}>Cancel</button>
                  </div>
                </div>}
                {editing?.id!==candidate.id&&<div className="candidate-actions">
                  <button type="button" className="record" disabled={busy!==null}
                    onClick={candidate.kind==="workflow"
                      ?()=>setEditing({id:candidate.id,title:candidate.title,steps:candidate.proposedSteps.join("\n")})
                      :()=>void update(candidate,"saved")}>
                    {busy===candidate.id?"Saving…":candidate.kind==="workflow"?"Review and save draft":"Save for review"}
                  </button>
                  <button type="button" className="secondary" disabled={busy!==null}
                    onClick={()=>void update(candidate,"dismissed")}>Dismiss</button>
                </div>}
                <details className="candidate-details">
                  <summary>More options</summary>
                  <div className="insights-suggestion-disclosure">
                    <button type="button" className="secondary" disabled={busy!==null}
                      onClick={()=>void update(candidate,"muted")}>Don't suggest again</button>
                  </div>
                </details>
              </article>
            ))}
          </div>
        </section>;
      })}
      {!!display.drafts.length&&<section className="insight-candidate-group">
        <div className="insight-group-heading">
          <h2>Saved personal playbook drafts</h2><span>{display.drafts.length}</span>
        </div>
        <div className="insight-candidate-grid">
          {display.drafts.map(draft=><article key={draft.id} className="insight-candidate-card">
            <p className="candidate-kind">Assistant · Draft</p>
            <h3>{draft.title}</h3>
            <details className="candidate-details">
              <summary>Draft steps</summary>
              <ol className="insights-suggested-steps">{draft.steps.map((step,i)=><li key={i}>{step}</li>)}</ol>
            </details>
            <p className="candidate-reason">Saved for review. This draft cannot execute or schedule actions.</p>
          </article>)}
        </div>
      </section>}
      {!!saved.filter(candidate=>candidate.kind!=="workflow").length&&<section className="insight-candidate-group">
        <div className="insight-group-heading"><h2>Saved Assistant suggestions</h2></div>
        <div className="insight-candidate-grid">
          {saved.filter(candidate=>candidate.kind!=="workflow").map(candidate=>
            <article key={candidate.id} className="insight-candidate-card">
              <p className="candidate-kind">Assistant · {LABELS[candidate.kind]}</p>
              <h3>{candidate.title}</h3>
              <p className="candidate-reason">{candidate.nextStep}</p>
            </article>)}
        </div>
      </section>}
    </div>
  );
}
