import {useEffect} from 'react';
import {useConversationWindow} from './useConversationWindow.js';

// Progressive admission belongs to the transcript. Its commits must not
// rebuild the workspace shell, navigation, model picker and composer.
export function ConversationWindow({id,messages,scroll,questionMessage,jump,taskId,onJumpHandled,children}){
 const windowed=useConversationWindow(id,messages,scroll,questionMessage);
 useEffect(()=>{
  if(!jump)return;
  if(jump.taskId!==taskId){onJumpHandled?.();return;}
  if(jump.messageIndex<windowed.start){windowed.older();return;}
  const element=scroll.viewport.current?.querySelector('[id="chapter-'+CSS.escape(jump.id)+'"]');
  if(element){scroll.onUserScroll();element.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
  onJumpHandled?.();
 },[jump,taskId,windowed.start,windowed.older,scroll.viewport,scroll.onUserScroll,onJumpHandled]);
 return children(windowed);
}
