// A queued ResizeObserver delivery can outlive React's ref and passive cleanup.
// Hold the observed element, and stop reads/publication as soon as it detaches.
export function observeWikiFrame(node,onSize,Observer=ResizeObserver){
 let active=true;
 const measure=()=>{if(!active||!node.isConnected)return;onSize({width:Math.max(320,Math.round(node.clientWidth)),height:Math.max(320,Math.round(node.clientHeight))});};
 const observer=new Observer(measure);observer.observe(node);measure();
 return ()=>{active=false;observer.disconnect();};
}
