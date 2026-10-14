// Notices the user may have missed: every toast, every Windows decision notification and host events, kept in order
// with an unread count for the rail bell (user request 2026-10-14). The list lives for the renderer session only.
import {useSyncExternalStore} from 'react';
let notices=[],unread=0,sequence=0,snapshotValue={notices,unread};
const listeners=new Set();
const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
const emit=()=>{snapshotValue={notices,unread};listeners.forEach(listener=>listener());};
const snapshot=()=>snapshotValue;
export function recordNotice({text,kind='info',error=false,success=false,action=null,source='app'}={}){
  const message=String(text||'').trim();if(!message)return null;
  const notice={id:++sequence,text:message,kind,error,success,action:action&&typeof action.onClick==='function'&&action.label?action:null,source,at:Date.now(),read:false};
  notices=[notice,...notices].slice(0,100);unread=notices.filter(item=>!item.read).length;emit();return notice;
}
export function markNoticesRead(){if(!unread)return;notices=notices.map(item=>item.read?item:{...item,read:true});unread=0;emit();}
export function clearNotices(){notices=[];unread=0;emit();}
export function useNotices(){return useSyncExternalStore(subscribe,snapshot,snapshot);}
