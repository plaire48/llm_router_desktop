import {useEffect} from 'react';

const blockers=new Set();
let approved=false;
const warn=event=>{
  if(approved){approved=false;return;}
  if(blockers.size){event.preventDefault();event.returnValue='';}
};
export function useBeforeUnload(dirty) {
  useEffect(()=>{
    if(!dirty)return;
    const blocker={};
    if(!blockers.size)window.addEventListener('beforeunload',warn);
    blockers.add(blocker);
    return()=>{blockers.delete(blocker);if(!blockers.size)window.removeEventListener('beforeunload',warn);};
  },[Boolean(dirty)]);
}
// The app already obtained explicit confirmation. Avoid a second browser prompt.
export function confirmedUnload(action) {
  approved=true;
  try{return action();}finally{setTimeout(()=>{approved=false;},0);}
}
