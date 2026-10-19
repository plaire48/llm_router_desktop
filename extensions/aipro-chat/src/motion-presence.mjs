// Publish modal presence only at its ownership boundary. A transcript prepend is
// not a modal change and must not invalidate every descendant through :has().
const owners=new WeakMap();
export function installMotionPresence(doc=document,Observer=MutationObserver){
 if(!doc.body||typeof Observer!=='function')return()=>{};
 let group=owners.get(doc);
 if(!group){
  let last,removal,expanded=[];
  const sync=()=>{
   expanded=[...doc.querySelectorAll('[aria-haspopup="dialog"][aria-expanded="true"]')];
   // Only an open control needs subtree removal observation. Closed transcripts
   // keep the cheap body-portal boundary and never trigger a document query.
   if(expanded.length){removal||=new Observer(()=>{if(expanded.some(node=>!node.isConnected))sync();});removal.observe(doc.body,{childList:true,subtree:true});}else removal?.disconnect();
   const open=[...doc.body.children].some(node=>node.matches?.('.cx-panel-backdrop'))||expanded.length>0;
   if(open!==last){last=open;doc.documentElement.toggleAttribute('data-motion-panel',open);}
  };
  const portals=new Observer(sync),controls=new Observer(sync);
  portals.observe(doc.body,{childList:true});controls.observe(doc.body,{attributes:true,subtree:true,attributeFilter:['aria-expanded','aria-haspopup']});
  group={count:0,portals,controls,stopRemoval:()=>removal?.disconnect()};owners.set(doc,group);sync();
 }
 group.count++;let active=true;
 return()=>{if(!active)return;active=false;if(!--group.count){group.portals.disconnect();group.controls.disconnect();group.stopRemoval();owners.delete(doc);doc.documentElement.removeAttribute('data-motion-panel');}};
}
