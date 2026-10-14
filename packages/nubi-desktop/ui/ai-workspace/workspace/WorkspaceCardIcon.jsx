import React,{useEffect,useState} from 'react';
import {Icon} from '../Icon';

export function WorkspaceIcon({icon,client}) {
  const [loaded,setLoaded]=useState(null),[failed,setFailed]=useState(null);
  const key=icon?.descriptor?.hash||icon?.hash;
  useEffect(()=>{
    let active=true;setLoaded(null);setFailed(null);
    if(icon&&!icon.preview)client.loadIcon(icon).then(src=>{if(active)setLoaded({key,src});}).catch(()=>{if(active)setFailed(key);});
    return()=>{active=false;};
  },[key,client,icon]);
  const src=icon?.preview||(loaded&&loaded.key===key?loaded.src:null);
  return <span className="workspace-icon" aria-hidden="true">{src&&failed!==key?<img src={src} alt="" width="24" height="24" onError={()=>setFailed(key)}/>:<Icon name="link" size={22}/>}</span>;
}
