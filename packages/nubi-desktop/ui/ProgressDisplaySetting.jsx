import React,{useState} from 'react';
const KEY='nubi.workspace.show-progress.v1';
export function useProgressDisplay(){
 const [enabled,setEnabled]=useState(()=>{try{return localStorage.getItem(KEY)!=='false';}catch{return true;}});
 return [enabled,value=>{setEnabled(value);try{localStorage.setItem(KEY,String(value));}catch{}}];
}
export function ProgressDisplaySetting({enabled,onChange}){
 return <div className="nubi-mail-switch-row"><div><strong>진행 과정 표시</strong><small>변경 결과, 질문과 승인은 항상 표시해요.</small></div><button type="button" role="switch" aria-label="진행 과정 표시" aria-checked={enabled} className="nubi-ios-switch" onClick={()=>onChange(!enabled)}><span aria-hidden="true"/></button></div>;
}
