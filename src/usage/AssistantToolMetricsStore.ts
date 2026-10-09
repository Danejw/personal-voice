import { toolIntelligence } from "@/assistant/harness/toolIntelligence";
import type { ToolResultAssessment, ToolOutcomeStatus, ToolFailureKind } from "@/assistant/harness/toolResults";
import type { AssistantUsageScope } from "@/usage/AssistantUsageStore";
import { localUsageDay } from "@/usage/assistantUsage";
import type { AssistantToolAttempt } from "@/usage/assistantToolMetrics";
import type { AssistantToolMetricsApi } from "@/services/assistantToolMetricsService";

const MAX_PENDING = 500;
const MAX_IN_FLIGHT = 128;
const MAX_ELAPSED_MS = 3_600_000;
const SAFE_NAME = /^[a-z][a-z0-9_]{0,79}$/;
type ActiveCall = { tool:string; family:AssistantToolAttempt["family"]; started:number };

/** Production metadata collection, independent from the opt-in *development* eval recorder. */
export class AssistantToolMetricsStore {
  private scope:AssistantUsageScope = {userId:null,deviceId:null,epoch:0,enabled:false};
  private active = new Map<string,ActiveCall>();
  private pending:AssistantToolAttempt[] = [];
  private flushing = false;
  private listeners = new Set<() => void>();

  constructor(
    private readonly api: AssistantToolMetricsApi,
    private readonly storage: Pick<Storage,"getItem"|"setItem"|"removeItem">,
    private readonly now:()=>number=()=>Date.now(),
    private readonly uuid:()=>string=()=>crypto.randomUUID(),
  ) {}

  subscribe = (listener:()=>void):(()=>void) => {
    this.listeners.add(listener);
    return ()=>{this.listeners.delete(listener);};
  };
  private publish():void {for(const listener of this.listeners) listener();}
  getPending():AssistantToolAttempt[] {return [...this.pending];}
  getScope():AssistantUsageScope {return {...this.scope};}
  private key(s:AssistantUsageScope):string {return `assistant.tools.pending.v1.${s.userId}.${s.epoch}.${s.deviceId}`;}

  setScope(next:AssistantUsageScope):void {
    const scope = {...next,enabled:!!next.enabled&&!!next.userId&&!!next.deviceId};
    if (JSON.stringify(scope)===JSON.stringify(this.scope)) return;
    const previous=this.scope;
    const changed=previous.userId!==scope.userId||previous.deviceId!==scope.deviceId||
      previous.epoch!==scope.epoch||!scope.enabled;
    if (changed) {
      this.active.clear();
      this.pending=[];
      if (previous.userId && (!scope.enabled||previous.userId!==scope.userId||
        previous.epoch!==scope.epoch||previous.deviceId!==scope.deviceId)) {
        try {this.storage.removeItem(this.key(previous));} catch {/* offline private cache */}
      }
    }
    this.scope=scope;
    if(scope.enabled&&changed) {
      try {
        const raw:unknown=JSON.parse(this.storage.getItem(this.key(scope))??"[]");
        if(Array.isArray(raw)) this.pending=raw.filter((e):e is AssistantToolAttempt=>
          !!e && typeof e==="object" && e.epoch===scope.epoch &&
          e.deviceId===scope.deviceId && typeof e.id==="string" &&
          typeof e.tool==="string" && SAFE_NAME.test(e.tool) &&
          typeof e.elapsedMs==="number").slice(-MAX_PENDING);
      } catch {this.pending=[];}
    }
    this.publish();
    this.flush();
  }

  /** Call identifiers exist ONLY in memory and are never written into analytics. */
  noteCalls(calls: readonly {id:string|null;name:string}[]):void {
    if(!this.scope.enabled) return;
    for(const call of calls) {
      if(!call.id || this.active.has(call.id) || this.active.size>=MAX_IN_FLIGHT) continue;
      const spec=toolIntelligence(call.name);
      const tool=spec&&SAFE_NAME.test(call.name)?call.name:"unknown_tool";
      this.active.set(call.id,{tool,family:spec?.family??"unknown",started:this.now()});
    }
  }

  noteResult(callId:string, _name:string, result:ToolResultAssessment):void {
    const attempt=this.active.get(callId);
    if(!attempt) return;
    this.active.delete(callId);
    this.capture(attempt,result.status,result.failure_kind);
  }

  /** Orphaned calls are incomplete, not falsely recorded as successes. */
  endSession():void {
    for(const attempt of this.active.values()) this.capture(attempt,"incomplete",null);
    this.active.clear();
  }

  private capture(attempt:ActiveCall,outcome:ToolOutcomeStatus,failureKind:ToolFailureKind):void {
    if(!this.scope.enabled || !this.scope.deviceId) return;
    const end=this.now();
    const elapsedMs=Math.max(0,Math.min(MAX_ELAPSED_MS,Math.round(end-attempt.started)));
    const event:AssistantToolAttempt={
      id:this.uuid(),deviceId:this.scope.deviceId,epoch:this.scope.epoch,
      occurredAt:new Date(end).toISOString(),localDay:localUsageDay(new Date(end)),
      tool:attempt.tool,family:attempt.family,outcome,failureKind,
      elapsedMs,goalVerified:null,
    };
    this.pending.push(event);
    if(this.pending.length>MAX_PENDING) this.pending.splice(0,this.pending.length-MAX_PENDING);
    this.persist();this.publish();this.flush();
  }

  private persist():void {
    if(!this.scope.enabled) return;
    try {this.storage.setItem(this.key(this.scope),JSON.stringify(this.pending));}
    catch {/* no raw content or alternate storage */}
  }

  flush():void {
    if(this.flushing||!this.scope.enabled||!this.scope.userId||!this.pending.length) return;
    const scope={...this.scope};
    this.flushing=true;
    void(async()=>{
      try {
        while(this.pending.length&&JSON.stringify(scope)===JSON.stringify(this.scope)) {
          const event=this.pending[0]!;
          if(Date.parse(event.occurredAt)<this.now()-13*86_400_000) {
            this.pending.shift();this.persist();continue;
          }
          await this.api.write(event,scope.userId!);
          if(JSON.stringify(scope)!==JSON.stringify(this.scope)) break;
          if(this.pending[0]?.id===event.id) this.pending.shift();
          this.persist();this.publish();
        }
      } catch {/* queued for later explicit refresh or next app load */}
      finally {
        this.flushing=false;
        if(JSON.stringify(scope)!==JSON.stringify(this.scope)&&this.pending.length) this.flush();
      }
    })();
  }
}
