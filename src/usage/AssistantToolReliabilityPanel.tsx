import { useEffect, useMemo, useState } from "react";
import { assistantToolMetricsApi } from "@/services/assistantToolMetricsService";
import { localUsageDay } from "@/usage/assistantUsage";
import { summarizeToolReliability, type AssistantToolAttempt } from "@/usage/assistantToolMetrics";
import type { AssistantToolMetricsStore } from "@/usage/AssistantToolMetricsStore";
import { HorizontalShareBars } from "@/usage/HorizontalShareBars";

interface Props {
  active:boolean; userId:string|null; epoch:number; enabled:boolean;
  store:AssistantToolMetricsStore;
}
const DAYS=[14,30] as const;
function dateBefore(days:number):string {
  const date=new Date();
  return localUsageDay(new Date(date.getFullYear(),date.getMonth(),date.getDate()-days));
}
const label=(name:string)=>name.replace(/_/g," ");
const msLabel=(ms:number|null)=>ms===null?"—":ms>=1000?`${(ms/1000).toFixed(1)}s`:`${ms}ms`;
function percent(value:number|null):string {return value===null?"—":`${Math.round(value*100)}%`;}

/** Phase B: tool attempts are not equivalent to verified task success. */
export function AssistantToolReliabilityPanel({active,userId,epoch,enabled,store}:Props) {
  const [days,setDays]=useState<(typeof DAYS)[number]>(14);
  const [pending,setPending]=useState(store.getPending());
  const [remote,setRemote]=useState<AssistantToolAttempt[]>([]);
  const [loadedKey,setLoadedKey]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [refresh,setRefresh]=useState(0);

  useEffect(()=>{
    const unsubscribe=store.subscribe(()=>setPending(store.getPending()));
    return ()=>{unsubscribe();};
  },[store]);

  const fromDay=dateBefore(days-1);
  useEffect(()=>{
    if(!active||!enabled||!userId) {
      setRemote([]);setLoadedKey(null);setError(null);setLoading(false);return;
    }
    let cancelled=false;
    setLoading(true);
    store.flush();
    void assistantToolMetricsApi.list(epoch,userId,fromDay).then(data=>{
      if(cancelled)return;
      setRemote(data);setLoadedKey(`${userId}:${epoch}:${fromDay}`);
      setLoading(false);setError(null);
    },(reason:unknown)=>{
      if(cancelled)return;
      setLoading(false);setError(reason instanceof Error?reason.message:"Tool Analytics could not be loaded.");
    });
    return ()=>{cancelled=true;};
  },[active,userId,epoch,enabled,fromDay,refresh,store]);

  const scope=store.getScope();
  const sameAccount=scope.userId===userId&&scope.epoch===epoch;
  const merged=useMemo(()=>{
    const saved=loadedKey===`${userId}:${epoch}:${fromDay}`?remote:[];
    const unique=new Map(saved.filter(r=>r.epoch===epoch).map(r=>[r.id,r]));
    if(sameAccount)for(const r of pending)if(r.epoch===epoch)unique.set(r.id,r);
    return [...unique.values()];
  },[remote,loadedKey,userId,epoch,fromDay,pending,sameAccount]);
  const summary=summarizeToolReliability(merged,fromDay,localUsageDay(new Date()));
  const top=Math.max(1,...summary.tools.map(t=>t.calls));
  const familyTop=Math.max(1,...summary.categories.map(t=>t.calls));

  if(!userId) return <p className="hint">Sign in to see Assistant tool reliability.</p>;
  if(!enabled) return <p className="hint">Usage intelligence is off. Tool activity is not collected.</p>;

  return (
    <div className="analytics" aria-label="Assistant tools and reliability">
      <div className="insights-tabs" role="group" aria-label="Tool reliability period">
        {DAYS.map(value=><button key={value} type="button" className={days===value?"insights-tab is-active":"insights-tab"} onClick={()=>setDays(value)}>{value} days</button>)}
        <button type="button" className="secondary" onClick={()=>setRefresh(n=>n+1)}>Refresh</button>
      </div>
      {loading&&<p className="hint">Loading tool metrics…</p>}
      {error&&<p className="error" role="alert">{error} Locally buffered metrics may still appear.</p>}
      <div className="stat-row">
        {([
          [summary.calls.toLocaleString(),"Tool attempts"],
          [percent(summary.resolvedRate),"Responses accepted"],
          [String(summary.failed+summary.blocked),"Failed / blocked"],
          [String(summary.incomplete),"Incomplete"],
          [msLabel(summary.medianMs),"Median elapsed"],
        ] as const).map(([value,name])=><div key={name} className="stat-cell">
          <p className="stat-value">{value}</p><p className="stat-label">{name}</p>
        </div>)}
      </div>
      {summary.calls===0?<p className="hint">No tool activity measured yet in this period. Tool metrics begin only after the Phase B update.</p>:(
        <>
          <section aria-label="Tool outcome breakdown">
            <h3>Outcomes</h3>
            <p>Observed results: {summary.observed} · Actions acknowledged: {summary.acknowledged} · Failed: {summary.failed} · Blocked: {summary.blocked} · Incomplete: {summary.incomplete}</p>
            <p>Cancelled: {summary.cancelled} · Guidance-only: {summary.reference} · P95 elapsed: {msLabel(summary.p95Ms)}</p>
            <p className="hint">Accepted response rate excludes cancellations and reference-only calls. Latency includes time awaiting a confirmation.</p>
            <p>Same-tool follow-ups after a failure (within 2 min): {summary.postFailureFollowUps}; subsequent accepted responses: {summary.postFailureAccepted}.</p>
            <p className="hint">These follow-ups are a timing heuristic, not proof of a retried task or successful recovery.</p>
          </section>
          <div className="analytics-visual-row">
            <HorizontalShareBars headingId="assistant-top-tools" title="Most-used tools"
              items={summary.tools.slice(0,8).map(t=>({id:t.key,label:label(t.key),share:Math.round(t.calls/top*100),detail:String(t.calls)}))}/>
            <HorizontalShareBars headingId="assistant-tool-families" title="Tool categories"
              items={summary.categories.map(t=>({id:t.key,label:label(t.key),share:Math.round(t.calls/familyTop*100),detail:String(t.calls)}))}/>
          </div>
          <div className="analytics-visual-row">
            <HorizontalShareBars headingId="assistant-failure-types" title="Failure reasons"
              empty="No classified failures or blocks in this period."
              items={summary.failures.slice(0,8).map(f=>({id:f.key,label:label(f.key),share:Math.round(f.count/Math.max(1,summary.failures[0]?.count??1)*100),detail:String(f.count)}))}/>
            <section aria-label="Tool response quality">
              <h3>Tool-level outcomes</h3>
              <p className="hint">Attempts / failed or blocked / median elapsed</p>
              {summary.tools.slice(0,8).map(t=><p key={t.key}>
                {label(t.key)}: {t.calls} / {t.failed+t.blocked} / {msLabel(t.medianMs)}
              </p>)}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
