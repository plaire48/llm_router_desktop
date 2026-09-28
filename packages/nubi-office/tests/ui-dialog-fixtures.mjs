// Render current dialog components to a DOM snapshot; no browser bundle is emitted.
import './ui-source-loader.mjs';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html lang="ko"><body><div id="fixture"></div></body></html>',{url:'https://source-preview.test',pretendToBeVisual:true});
for(const name of ['window','document','navigator','HTMLElement','Element','Node','MutationObserver','getComputedStyle','innerWidth','innerHeight'])Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]});
globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
dom.window.HTMLElement.prototype.scrollIntoView=function(){};
const {createRoot}=await import('react-dom/client');
const {flushSync}=await import('react-dom');
const {notifyToast}=await import('@e2e/cx-design-system');
export async function dialogSnapshot(element,feedback,prepare){
  const root=createRoot(document.getElementById('fixture'));
  flushSync(()=>root.render(element));
  await new Promise(resolve=>setTimeout(resolve,20));
  if(feedback){flushSync(()=>notifyToast(feedback.message,{source:'source-preview',error:!!feedback.error}));await new Promise(resolve=>setTimeout(resolve,20));}
  if(prepare)await prepare();
  // HTML serialization omits a select's live value. Preserve the rendered state
  // so static Chrome captures do not silently show the first option instead.
  for(const select of document.querySelectorAll('select')){
    const selected=[...select.options].map(option=>option.selected);
    [...select.options].forEach((option,index)=>option.toggleAttribute('selected',selected[index]));
  }
  const content=document.body.innerHTML;
  if(feedback)flushSync(()=>notifyToast('',{source:'source-preview'}));
  flushSync(()=>root.unmount());
  return content;
}
export function closeFixtures(){dom.window.close();}
