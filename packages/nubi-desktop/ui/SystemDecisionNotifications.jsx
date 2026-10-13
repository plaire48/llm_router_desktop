import {useEffect,useRef} from 'react';

// Windows owns notification placement and dismissal. This component renders nothing.
export function SystemDecisionNotifications({decisions,onOpen}){
 const sent=useRef(new Map()),latest=useRef({decisions,onOpen});latest.current={decisions,onOpen};
 const signature=decisions.map(row=>row.id).sort().join('\n');
 useEffect(()=>{
  if(!window.nubi?.desktop)return;
  const next=new Map(latest.current.decisions.map(row=>[row.id,row]));
  for(const id of sent.current.keys())if(!next.has(id))void window.nubi.request('decisionNotice',{id,action:'clear'}).catch(()=>{});
  for(const [id,row] of next)if(!sent.current.has(id))void window.nubi.request('decisionNotice',{id,kind:row.kind,projectName:row.projectName,taskTitle:row.taskTitle,summary:row.summary,action:'show'}).catch(()=>{});
  sent.current=next;
 },[signature]);
 useEffect(()=>{
  const off=window.nubi?.onHostEvent?.(event=>{
   if(event.type!=='decision_open')return;
   const current=latest.current.decisions.find(row=>row.id===event.id);
   if(current)void latest.current.onOpen(current);
  });
  return()=>{off?.();for(const id of sent.current.keys())void window.nubi?.request?.('decisionNotice',{id,action:'clear'}).catch(()=>{});sent.current.clear();};
 },[]);
 return null;
}
