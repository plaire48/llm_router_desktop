import {useEffect,useState} from 'react';
const EMPTY=[];

// Only a newly delivered answer in the conversation already being watched.
// History, navigation, questions and a remounted conversation are immediate.
export function useAnswerReveal(task,projectId){
  const scope=`${projectId||''}:${task?.id||''}`;
  const messages=task?.messages||EMPTY;
  const [seen,setSeen]=useState(()=>({scope,messages,ids:new Set(messages.map(m=>m.id)),reveal:new Set()}));
  useEffect(()=>{
    if(!seen.reveal.size)return;
    const timer=setTimeout(()=>setSeen(previous=>previous===seen?{...previous,reveal:new Set()}:previous),1100);
    return()=>clearTimeout(timer);
  },[seen]);
  if(seen.scope!==scope){
    setSeen({scope,messages,ids:new Set(messages.map(m=>m.id)),reveal:new Set()});
    return new Set();
  }
  if(seen.messages!==messages){
    const reveal=new Set(seen.reveal),last=messages.at(-1);
    if(last?.id&&!seen.ids.has(last.id)&&last.role==='assistant'&&!last.questionId&&!last.error&&last.runId&&
      [task?.responseTiming?.runId,task?.checkpoint?.runId].includes(last.runId))reveal.add(last.id);
    const ids=new Set(messages.map(m=>m.id));
    for(const id of reveal)if(!ids.has(id))reveal.delete(id);
    setSeen({scope,messages,ids,reveal});
    return reveal;
  }
  return seen.reveal;
}
