import type { AssistantUsageEvent } from "@/usage/assistantUsage";

const WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"] as const;
export interface AssistantUsageFacts {
  turns: number;
  activeDays: number;
  peakDay: string | null;
  peakHourStart: number | null;
  peakHourEnd: number | null;
  peakDeviceId: string | null;
  peakDeviceShare: number | null;
  voiceTurns: number;
  typedTurns: number;
  unknownTurns: number;
  dayCounts: number[];
  hourCounts: number[];
  deviceCounts: {deviceId:string;count:number}[];
}

/** Derived only from actual finalized user-turn events, not from model-generated prose.
 * Hour distribution uses the viewing device's local time zone for ISO UTC timestamps;
 * weekday distribution uses originating device's local calendar day.
 */
export function assistantUsageFacts(events:readonly AssistantUsageEvent[]):AssistantUsageFacts {
  const dayCounts=Array.from({length:7},()=>0);
  const hourCounts=Array.from({length:24},()=>0);
  const devices=new Map<string,number>();
  const activeDays=new Set<string>();
  let turns=0,voiceTurns=0,typedTurns=0;
  for(const event of events) {
    if(event.kind!=="user_turn")continue;
    const date=new Date(event.occurredAt);
    const local=new Date(`${event.localDay}T12:00:00`);
    if(!Number.isFinite(date.getTime())||!Number.isFinite(local.getTime()))continue;
    turns++;
    activeDays.add(event.localDay);
    const week=local.getDay(),hour=date.getHours();
    dayCounts[week]=(dayCounts[week]??0)+1;
    hourCounts[hour]=(hourCounts[hour]??0)+1;
    devices.set(event.deviceId,(devices.get(event.deviceId)??0)+1);
    if(event.modality==="voice")voiceTurns++;
    if(event.modality==="typed")typedTurns++;
  }
  if(!turns)return {
    turns:0,activeDays:0,peakDay:null,peakHourStart:null,peakHourEnd:null,
    peakDeviceId:null,peakDeviceShare:null,voiceTurns:0,typedTurns:0,unknownTurns:0,
    dayCounts,hourCounts,deviceCounts:[],
  };
  let peakDay=0;
  for(let i=1;i<7;i++)if((dayCounts[i]??0)>(dayCounts[peakDay]??0))peakDay=i;
  let peakHour=0,highest=-1;
  for(let start=0;start<24;start++){
    const count=(hourCounts[start]??0)+(hourCounts[(start+1)%24]??0)+(hourCounts[(start+2)%24]??0);
    if(count>highest){highest=count;peakHour=start;}
  }
  const peakDevices=new Map<string,number>();
  let peakTotal=0;
  for(const event of events){
    if(event.kind!=="user_turn")continue;
    const date=new Date(event.occurredAt);
    if(!Number.isFinite(date.getTime()))continue;
    const hour=date.getHours();
    if(![0,1,2].some(n=>(peakHour+n)%24===hour))continue;
    peakTotal++;
    peakDevices.set(event.deviceId,(peakDevices.get(event.deviceId)??0)+1);
  }
  const top=[...peakDevices.entries()].sort((a,b)=>b[1]-a[1])[0]??null;
  return {
    turns,activeDays:activeDays.size,peakDay:WEEKDAYS[peakDay]??null,
    peakHourStart:peakHour,peakHourEnd:(peakHour+3)%24,
    peakDeviceId:top?.[0]??null,
    peakDeviceShare:top&&peakTotal?Math.round(top[1]/peakTotal*100):null,
    voiceTurns,typedTurns,unknownTurns:turns-voiceTurns-typedTurns,dayCounts,hourCounts,
    deviceCounts:[...devices].map(([deviceId,count])=>({deviceId,count})).sort((a,b)=>b.count-a.count),
  };
}
