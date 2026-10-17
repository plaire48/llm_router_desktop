import {useMemo,useRef,useState} from 'react';
import {mergeSnapshot} from './mergeSnapshot.js';

// Reserve the owning project's composer before async source preparation.
// The normal state poll takes over once the host has admitted its live writer.
export function useWikiWorkApi(request,project,setProject){
  const owner=useRef(project?.projectId);owner.current=project?.projectId;
  const [pending,setPending]=useState(null);
  const api=useMemo(()=>async(method,args={})=>{
    const starting=method==='wikiInitialization'&&['reset','retry'].includes(args.action)||
      method==='wikiUpdate'&&['refresh','run','resume'].includes(args.method);
    if(!starting)return request(method,args);
    const projectId=owner.current,job={id:crypto.randomUUID(),projectId,kind:method==='wikiUpdate'?'update':'init',state:'running',stage:'preparing_runtime',startedAt:new Date().toISOString()};
    setPending(job);
    try{return await request(method,args);}
    finally{
      // A rejected admission restores the composer; late replies never lock
      // or replace a different project after navigation.
      try{const state=await request('state',{});if(owner.current===projectId)setProject(value=>value?.projectId===projectId?mergeSnapshot(value,state):value);}catch{}
      setPending(value=>value===job?null:value);
    }
  },[request,setProject]);
  return {api,pending:pending?.projectId===project?.projectId?pending:null};
}
