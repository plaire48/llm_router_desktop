import {startTransition,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {frameCoalescer} from './frame-coalescer.mjs';

export function seedProgressiveIndices({start=0,end,firstStart=start,firstEnd=end,include=[]}){
 const indices=new Set();
 for(let i=Math.max(start,firstStart);i<Math.min(end,firstEnd);i++)indices.add(i);
 for(const i of include)if(Number.isInteger(i)&&i>=start&&i<end)indices.add(i);
 return indices;
}
export function advanceProgressiveIndices(indices,{start=0,end,batchSize=4,direction='forward'}){
 const added=[];
 for(let i=direction==='backward'?end-1:start;i>=start&&i<end&&added.length<batchSize;i+=direction==='backward'?-1:1)if(!indices.has(i))added.push(i);
 return added.length?new Set([...indices,...added]):indices;
}
// Shared admission owns scheduling, generation cancellation and post-layout
// restoration. Callers own their page boundaries, row keys and viewport model.
export function useProgressiveList({id,start=0,end,firstStart=start,firstEnd=end,include=[],batchSize=4,direction='forward',beforeBatch,onCommit}){
 const includeKey=include.join(','),[state,setState]=useState(()=>({id,indices:seedProgressiveIndices({start,end,firstStart,firstEnd,include})}));
 const indices=useMemo(()=>{
  const seed=seedProgressiveIndices({start,end,firstStart,firstEnd,include});
  if(state.id!==id)return seed;
  if([...state.indices].every(i=>i>=start&&i<end)&&[...seed].every(i=>state.indices.has(i)))return state.indices;
  return new Set([...state.indices].filter(i=>i>=start&&i<end).concat([...seed]));
 },[id,start,end,firstStart,firstEnd,includeKey,state]);
 const loading=indices.size<Math.max(0,end-start),pending=useRef(null),restored=useRef(Promise.resolve()),layoutRestored=useRef(false),painted=useRef(null),generation=useRef(id),cadence=useRef({id,count:0}),capture=useRef(beforeBatch),observe=useRef(onCommit);capture.current=beforeBatch;observe.current=onCommit;
 useLayoutEffect(()=>{
  if(generation.current!==id){generation.current=id;pending.current=null;restored.current=Promise.resolve();layoutRestored.current=false;}
  if(state.id!==id||state.indices!==indices)setState({id,indices});
  const saved=pending.current;pending.current=null;
  observe.current?.({count:indices.size,loading,durationMs:saved?.startedAt===undefined?0:performance.now()-saved.startedAt});
  if(saved&&saved.id===id){const result=saved.restore?.();layoutRestored.current=!!result?.then;restored.current=Promise.resolve(result);}
 },[id,indices]);
 useEffect(()=>{
  if(!loading)return;
  let cancelled=false,task;
  const admit=()=>{
   if(cancelled)return;
   pending.current={id,restore:capture.current?.(),startedAt:observe.current?performance.now():undefined};
   if(cadence.current.id!==id)cadence.current={id,count:0};
   cadence.current.count++;
   startTransition(()=>setState({id,indices:advanceProgressiveIndices(indices,{start,end,batchSize,direction})}));
  };
  // rAF runs before paint. Keep the seed through two presentation opportunities
  // so mount layout and the first prepend do not consume consecutive frames.
  // Subsequent batches still use post-layout restoration without extra fences.
  const nextPaint=frameCoalescer(admit),settledPaint=frameCoalescer(()=>nextPaint.schedule()),firstPaint=frameCoalescer(()=>settledPaint.schedule());
  restored.current.then(()=>{
   if(cancelled)return;
   if(painted.current!==id){painted.current=id;firstPaint.schedule();}
   // An asynchronous restoration already waited for layout (the conversation
   // ResizeObserver). Its next task runs after that paint; do not add another
   // frame fence. Lists without restoration still yield every12 admitted rows.
   else if(!layoutRestored.current&&cadence.current.count%3===1)nextPaint.schedule();
   else task=setTimeout(admit,0);
  });
  return()=>{cancelled=true;clearTimeout(task);nextPaint.cancel();settledPaint.cancel();firstPaint.cancel();};
 },[id,start,end,indices,loading,batchSize,direction]);
 return {indices,loading};
}
