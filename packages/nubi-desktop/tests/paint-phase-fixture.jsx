import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {deferredScreen} from '../ui/deferred-screen.jsx';
import {WorkspaceNavigation} from '../ui/WorkspaceNavigation.jsx';
import {useConversationScroll} from '../ui/useConversationScroll.js';
window.paintProbe={ticks:0,renders:[],preloads:[],geometry:[],offsetReads:0,preLayoutOffsetReads:0};
const tick=()=>{window.paintProbe.ticks++;requestAnimationFrame(tick);};requestAnimationFrame(tick);
const NativeObserver=ResizeObserver;let observing=false;
window.ResizeObserver=class extends NativeObserver{constructor(callback){super((...args)=>{observing=true;try{callback(...args);}finally{observing=false;}});}};
for(const property of ['scrollHeight','clientHeight']){const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,property);Object.defineProperty(Element.prototype,property,{...descriptor,get(){if(this.matches?.('.scroll-viewport')&&!observing)window.paintProbe.geometry.push(property);return descriptor.get.call(this);}});}
const offset=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');Object.defineProperty(Element.prototype,'scrollTop',{...offset,get(){if(this.matches?.('.scroll-viewport')){window.paintProbe.offsetReads++;if(!observing)window.paintProbe.preLayoutOffsetReads++;}return offset.get.call(this);}});
function Heavy(){window.paintProbe.renders.push(window.paintProbe.ticks);return <p>준비된 화면</p>;}
const Screen=deferredScreen(()=>Promise.resolve({Heavy}),'Heavy');
function Fixture(){
 useState(()=>{window.paintProbe.startedAt=window.paintProbe.ticks;return null;});
 const [visible,setVisible]=useState(true),[lines,setLines]=useState(2),scroll=useConversationScroll('paint-fixture');
 window.paintActions={grow:()=>setLines(n=>n+20),scroll:()=>scroll.onScroll({currentTarget:scroll.viewport.current}),hide:()=>setVisible(false),show:()=>setVisible(true)};
 return <><h1>작업 화면</h1><input aria-label="유지할 초안"/><WorkspaceNavigation rail onMail={()=>{}} onWiki={()=>{}} onWorkflow={()=>{}} onPreloadScreen={name=>window.paintProbe.preloads.push(name)} onView={()=>{}}/>
 {visible&&<Screen/>}<div className="scroll-viewport" ref={scroll.viewport} onScroll={scroll.onScroll} style={{height:120,overflow:'auto'}}><div className="scroll-body" ref={scroll.content}>{Array.from({length:lines},(_,i)=><p key={i}>합성 행 {i}</p>)}</div></div><button onClick={scroll.followLatest}>최신으로</button></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
