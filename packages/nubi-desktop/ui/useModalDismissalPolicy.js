import {useEffect} from 'react';
import {installModalStack} from './modalStack.js';

// Keep CX's modal focus/keyboard lifecycle and close guards. The original
// trigger is the only interactive spot through the otherwise inert backdrop.
export function useModalDismissalPolicy() {
 useEffect(()=>{
  const stopStack=installModalStack();
  const triggers=new WeakMap();let lastActivation=null,frame=0,transition=0;
  // A slash action or keyboard shortcut may open a picker after its option has
  // unmounted. Bind these surfaces to their stable composer opener instead of
  // inferring ownership solely from the last pointer event.
  const composerSurfaces=[
   ['.nubi-composer-skill-menu','.nubi-composer-skill-trigger'],
   ['.model-dialog','.model-trigger'],
   ['.context-dialog','.context-trigger'],
   ['.nubi-reasoning-menu','.nubi-reasoning-trigger'],
   ['.nubi-approval-mode-menu','.nubi-approval-mode-button']
  ];
  const composerPickers=composerSurfaces.map(([,selector])=>selector).join(',');
  const dialogs=()=>[...document.querySelectorAll('[aria-modal="true"]')].filter(node=>node.getClientRects().length&&!node.closest('[inert],[hidden],[data-modal-motion="leaving"]'));
  const register=()=>{
   for(const dialog of dialogs()){
    if(triggers.has(dialog))continue;
    const selector=composerSurfaces.find(([surface])=>dialog.matches(surface))?.[1];
    const openers=selector?[...document.querySelectorAll(`form.composer ${selector}`)].filter(node=>node.getClientRects().length):[];
    const stable=openers.length===1?openers[0]:null;
    const recent=lastActivation&&performance.now()-lastActivation.at<=1000?lastActivation.node:null;
    const trigger=stable||recent;
    if(trigger?.isConnected&&!dialog.contains(trigger))triggers.set(dialog,trigger);
   }
  };
  // Portals are direct body children. Never observe every streaming text change.
  const changes=new MutationObserver(register);changes.observe(document.body,{childList:true});
  const containsPoint=(node,event)=>{const box=node.getBoundingClientRect();return box.width>0&&box.height>0&&event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom;};
  const closeAndFocus=(dialog,target,activate=false)=>{
   const close=dialog.querySelector(':scope > .cx-panel-header .cx-action-button[data-action="close"], .nubi-modal-close, .nubi-skill-menu-close');
   if(!close||close.disabled||dialog.getAttribute('aria-busy')==='true')return;
   close.click();cancelAnimationFrame(transition);
   transition=requestAnimationFrame(()=>{
    transition=0;
    if(dialog.isConnected&&!dialog.closest('[data-modal-motion="leaving"]')||!target.isConnected||target.disabled||target.closest('[inert]')||dialogs().length)return;
    if(activate)target.click();else target.focus({preventScroll:true});
   });
  };
  const handle=event=>{
   if(!(event.target instanceof Element)||!document.querySelector('.desktop-shell'))return;
   register();
   const dialog=dialogs().at(-1),trigger=dialog&&triggers.get(dialog);
   const pointer=event.type!=='click'||event.detail>0;
   // Composer choices replace each other. Close through the real guarded X,
   // release its inert/focus ownership, then activate the new opener once.
   const composer=trigger?.matches(composerPickers)&&trigger.closest('form.composer');
   const replacement=dialog&&composer&&pointer&&event.button===0&&!containsPoint(dialog,event)&&[...composer.querySelectorAll(composerPickers)].find(node=>node!==trigger&&!node.disabled&&containsPoint(node,event));
   if(replacement){
    event.preventDefault();event.stopImmediatePropagation();
    if(event.type==='click')closeAndFocus(dialog,replacement,true);
    return;
   }
   if(dialog&&trigger?.isConnected&&pointer&&event.button===0&&!dialog.contains(event.target)&&!containsPoint(dialog,event)&&containsPoint(trigger,event)){
    event.preventDefault();event.stopImmediatePropagation();
    // Use the real close action; disabled/busy dialogs and custom recovery
    // handlers keep exactly the same behavior as clicking their X.
    if(event.type==='click')closeAndFocus(dialog,trigger);
    return;
   }
   const backdrop=event.target;
   if(backdrop.matches('.cx-panel-backdrop')&&backdrop.querySelector(':scope > .deck-dialog[aria-modal="true"]')){
    event.preventDefault();event.stopImmediatePropagation();return;
   }
   if(event.type==='click'){
    const button=event.target.closest('button,[role="button"]');
    if(button&&!button.disabled){lastActivation={node:button,at:performance.now()};cancelAnimationFrame(frame);frame=requestAnimationFrame(register);}
   }
  };
  const events=['pointerdown','mousedown','pointerup','mouseup','click'];
  for(const type of events)document.addEventListener(type,handle,true);
  return()=>{stopStack();changes.disconnect();cancelAnimationFrame(frame);cancelAnimationFrame(transition);for(const type of events)document.removeEventListener(type,handle,true);};
 },[]);
}
