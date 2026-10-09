import { describe, expect, it, vi } from "vitest";
import { interpretToolResult } from "@/assistant/harness/toolResults";
import type { AssistantToolMetricsApi } from "@/services/assistantToolMetricsService";
import { AssistantToolMetricsStore } from "@/usage/AssistantToolMetricsStore";
import { summarizeToolReliability, type AssistantToolAttempt } from "@/usage/assistantToolMetrics";

function harness() {
  const files=new Map<string,string>();
  const storage={
    getItem:(k:string)=>files.get(k)??null,
    setItem:(k:string,v:string)=>{files.set(k,v);},
    removeItem:(k:string)=>{files.delete(k);},
  };
  let now=Date.UTC(2026,9,9,19,0), n=0;
  const api:AssistantToolMetricsApi={
    write:vi.fn(async()=>{throw new Error("offline");}),
    list:vi.fn(async()=>[]),
  };
  const store=new AssistantToolMetricsStore(api,storage,()=>now,
    ()=>`00000000-0000-4000-8000-${String(++n).padStart(12,"0")}`);
  const scope={userId:"user1",deviceId:"device1",epoch:2,enabled:true};
  return {store,scope,files,api,tick:(ms:number)=>{now+=ms;}};
}
describe("Assistant tool reliability metadata",()=>{
  it("records one classified attempt without arguments, raw results, or call IDs",()=>{
    const t=harness();t.store.setScope(t.scope);
    t.store.noteCalls([{id:"secret-call-id",name:"copy_text"}]);
    t.tick(1500);
    t.store.noteResult("secret-call-id","copy_text",interpretToolResult("copy_text",true,"copied SECRET"));
    const items=t.store.getPending();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({tool:"copy_text",family:"text",outcome:"acknowledged",
      elapsedMs:1500,goalVerified:null,failureKind:null,epoch:2});
    expect(JSON.stringify(items)).not.toContain("secret-call-id");
    expect(JSON.stringify(items)).not.toContain("SECRET");
    t.store.noteResult("secret-call-id","copy_text",interpretToolResult("copy_text",true,"again"));
    expect(t.store.getPending()).toHaveLength(1);
  });
  it("keeps failure categories, cancellations and guidance separate from outcomes",()=>{
    const t=harness();t.store.setScope(t.scope);
    t.store.noteCalls([
      {id:"a",name:"open_app"},{id:"b",name:"create_voice_note"},
      {id:"c",name:"get_tool_playbook"},
    ]);
    t.store.noteResult("a","open_app",interpretToolResult("open_app",false,"Windows only"));
    t.store.noteResult("b","create_voice_note",interpretToolResult("create_voice_note",false,"User cancelled"));
    t.store.noteResult("c","get_tool_playbook",interpretToolResult("get_tool_playbook",true,"playbook"));
    expect(t.store.getPending().map(r=>[r.outcome,r.failureKind])).toEqual([
      ["blocked","unavailable"],["cancelled","cancelled"],["reference",null],
    ]);
  });
  it("labels orphaned tool calls incomplete, not verified or successful",()=>{
    const t=harness();t.store.setScope(t.scope);
    t.store.noteCalls([{id:"unfinished",name:"supervise_screen"}]);
    t.tick(2_000);t.store.endSession();
    expect(t.store.getPending()[0]).toMatchObject({outcome:"incomplete",goalVerified:null,elapsedMs:2_000});
    t.store.noteResult("unfinished","supervise_screen",interpretToolResult("supervise_screen",true,"done"));
    expect(t.store.getPending()).toHaveLength(1);
  });
  it("does not collect without consent and drops pending data on epoch/account switches",()=>{
    const t=harness();
    t.store.setScope({...t.scope,enabled:false});
    t.store.noteCalls([{id:"off",name:"copy_text"}]);
    t.store.noteResult("off","copy_text",interpretToolResult("copy_text",true,"done"));
    expect(t.store.getPending()).toHaveLength(0);
    t.store.setScope(t.scope);
    t.store.noteCalls([{id:"on",name:"open_app"}]);
    t.store.noteResult("on","open_app",interpretToolResult("open_app",false,"Offline device"));
    expect(t.store.getPending()).toHaveLength(1);
    t.store.setScope({...t.scope,epoch:3});
    expect(t.store.getPending()).toHaveLength(0);
    expect([...t.files.keys()].some(k=>k.includes(".2."))).toBe(false);
    t.store.noteCalls([{id:"new",name:"copy_text"}]);
    t.store.setScope({userId:"user2",deviceId:"device2",epoch:3,enabled:true});
    t.store.noteResult("new","copy_text",interpretToolResult("copy_text",true,"done"));
    expect(t.store.getPending()).toHaveLength(0);
  });
  it("bounds elapsed time and replaces malformed names with an explicit unknown tool",()=>{
    const t=harness();t.store.setScope(t.scope);
    t.store.noteCalls([{id:"fake",name:"bad user private name"}]);
    t.tick(4_000_000);
    t.store.noteResult("fake","bad user private name",interpretToolResult("whatever",false,"bad"));
    expect(t.store.getPending()[0]).toMatchObject({tool:"unknown_tool",family:"unknown",elapsedMs:3_600_000});
  });
  it("provides per-tool failure, latency and accepted-response statistics without goal claims",()=>{
    const template:AssistantToolAttempt={
      id:"1",deviceId:"device1",epoch:1,occurredAt:"2026-10-09T19:00:00Z",
      localDay:"2026-10-09",tool:"copy_text",family:"text",outcome:"acknowledged",
      failureKind:null,elapsedMs:40,goalVerified:null,
    };
    const rows:AssistantToolAttempt[]=[
      template,{...template,id:"2",outcome:"observed",elapsedMs:100},
      {...template,id:"3",tool:"open_app",family:"windows",outcome:"failed",
        failureKind:"stale_target",elapsedMs:500},
      {...template,id:"4",tool:"open_app",family:"windows",outcome:"blocked",
        failureKind:"offline",elapsedMs:600},
      {...template,id:"5",tool:"get_tool_playbook",family:"harness",outcome:"reference",elapsedMs:10},
      {...template,id:"6",tool:"open_app",family:"windows",outcome:"cancelled",
        failureKind:"cancelled",elapsedMs:1_000},
    ];
    const metrics=summarizeToolReliability(rows,"2026-10-09","2026-10-09");
    expect(metrics).toMatchObject({calls:6,acknowledged:1,observed:1,failed:1,
      blocked:1,cancelled:1,reference:1,resolvedRate:.5,medianMs:100,p95Ms:1_000});
    expect(metrics.failures[0]).toMatchObject({key:"stale_target",count:1});
    expect(metrics.tools.find(t=>t.key==="open_app")?.calls).toBe(3);
    expect(summarizeToolReliability(rows,"2026-10-01","2026-10-08").resolvedRate).toBeNull();
  });
});
