import {useEffect,useRef} from 'react';
// Native geometry changes only when a pane opens/closes, never for polling or
// each ResizeObserver frame. The host preserves manually chosen window bounds.
export function useWindowExpansion(open,minimumWidth){
 const width=useRef(minimumWidth);width.current=minimumWidth;
 useEffect(()=>{
  if(window.nubi?.desktop!==true)return;
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const update=()=>{void window.nubi.request('windowLayout',{open:!!open,minimumWidth:Math.ceil(width.current),reduced:media.matches}).catch(()=>{});};
  update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);
 },[!!open]);
}
