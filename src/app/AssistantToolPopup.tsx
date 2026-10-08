import { useEffect, useState } from "react";
import { listen, emitTo } from "@tauri-apps/api/event";

type Popup = {
  pending: {id:string;title:string;preview:string;working:boolean} | null;
  activity: {id:string;label:string;status:"running"|"completed"|"failed"} | null;
  computerPrompt: string | null;
  computerRunning: boolean;
};

export default function AssistantToolPopup() {
  const [state,setState] = useState<Popup>({pending:null,activity:null,computerPrompt:null,computerRunning:false});
  useEffect(()=>{
    const listener=listen<Popup>("assistant-popup-state",event=>setState(event.payload));
    return ()=>{void listener.then(fn=>fn());};
  },[]);
  const approval=state.pending&&!state.pending.working?state.pending:null;
  const askComputer=!approval&&state.computerPrompt;
  const label=approval?.title??(askComputer?"Computer action requires approval":state.activity?.label??(state.computerRunning?"Computer task in progress":""));
  const status=approval||askComputer?"Approval needed":state.activity?.status==="failed"?"Failed":state.activity?.status==="completed"?"Completed":"Working";
  return <div style={{background:"rgba(22,25,33,.96)",border:"1px solid rgba(255,255,255,.16)",
    borderRadius:13,padding:15,color:"#f4f6fa",fontFamily:"system-ui,Segoe UI,sans-serif",
    boxShadow:"0 8px 30px rgba(0,0,0,.35)",minHeight:125,boxSizing:"border-box"}}>
    <div style={{fontSize:11,opacity:.68,marginBottom:6}}>Personal Voice · {status}</div>
    <div style={{fontWeight:650,fontSize:14,marginBottom:6,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</div>
    {approval&&<div style={{fontSize:12,opacity:.83,maxHeight:34,overflow:"hidden",marginBottom:8}}>{approval.preview}</div>}
    {askComputer&&!approval&&<div style={{fontSize:12,opacity:.83,maxHeight:34,overflow:"hidden",marginBottom:8}}>{askComputer}</div>}
    {approval||askComputer?<div style={{display:"flex",gap:8}}>
      <button type="button" onClick={()=>void emitTo("main","assistant-popup-answer",{id:approval?.id??null,allow:true,kind:approval?"tool":"computer"})} style={{padding:"7px 14px",background:"#75aaff",border:0,borderRadius:8,color:"#06172c",fontWeight:600}}>Allow once</button>
      <button type="button" onClick={()=>void emitTo("main","assistant-popup-answer",{id:approval?.id??null,allow:false,kind:approval?"tool":"computer"})} style={{padding:"7px 14px",background:"#353a46",border:0,borderRadius:8,color:"white"}}>Deny</button>
    </div>:<div style={{fontSize:12,opacity:.7}}>Actions and status are also visible in the Assistant page.</div>}
  </div>;
}
