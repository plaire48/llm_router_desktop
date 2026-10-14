import {useEffect,useRef} from 'react';

// Re-read shared catalogs on return and while visible, without interrupting drafts.
export function useCatalogRefresh({blocked,onRefresh}){
  const latest=useRef({blocked,onRefresh});latest.current={blocked,onRefresh};
  useEffect(()=>{
    let active=true,running=false,last=0;
    const refresh=async()=>{
      if(!active||running||latest.current.blocked||document.visibilityState==='hidden'||Date.now()-last<1000)return;
      running=true;last=Date.now();
      try{await latest.current.onRefresh(()=>active&&!latest.current.blocked);}catch{/* Keep the current view; explicit reads show errors. */}finally{running=false;}
    };
    const timer=setInterval(refresh,30000);
    window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[]);
}
