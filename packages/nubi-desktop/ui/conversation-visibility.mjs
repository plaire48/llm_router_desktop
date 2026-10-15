// One observer per transcript. Keep measured layout and DOM available for text
// selection/search, but don't animate hundreds of mascots outside the viewport.
const observers=new WeakMap();
export function observeConversationVisibility(node){
 const root=node?.closest('.nubi-conversation-scroll');
 if(!root||typeof IntersectionObserver==='undefined')return ()=>{};
 let group=observers.get(root);
 if(!group){
  group={count:0,observer:new IntersectionObserver(entries=>{
   for(const entry of entries){
    // Seed skipped layout with the observed, actual border-box height instead
    // of a guessed message height. Keep auto content searchable/accessible.
    if(entry.boundingClientRect.height>0)entry.target.style.setProperty('--nubi-message-height',entry.boundingClientRect.height+'px');
    entry.target.toggleAttribute('data-message-offscreen',!entry.isIntersecting);
   }
  },{root,rootMargin:'200px'})};observers.set(root,group);
 }
 group.count++;group.observer.observe(node);
 return ()=>{group.observer.unobserve(node);node.removeAttribute('data-message-offscreen');if(!--group.count){group.observer.disconnect();observers.delete(root);}};
}
