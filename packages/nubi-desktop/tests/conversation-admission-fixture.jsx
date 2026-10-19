import React,{useLayoutEffect,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useConversationScroll} from '../ui/useConversationScroll.js';
import {ConversationWindow} from '../ui/ConversationWindow.jsx';
const messages=Array.from({length:160},(_,i)=>({id:'m'+i}));
window.admission={commits:[],frames:[],positions:[],shellRenders:0};
function Conversation(){
 window.admission.shellRenders++;
 const scroll=useConversationScroll('fixture');
 return <ConversationWindow id="fixture" messages={messages} scroll={scroll}>{windowed=><AdmissionRows scroll={scroll} windowed={windowed}/>}</ConversationWindow>;
}
function AdmissionRows({scroll,windowed}){
 useLayoutEffect(()=>{window.admission.commits.push({at:performance.now(),count:160-windowed.start,busy:windowed.loading});});
 useEffect(()=>{const observer=new ResizeObserver(()=>{const node=document.querySelector('[data-message-key="m159"]');window.admission.positions.push(node.getBoundingClientRect().top);});observer.observe(scroll.content.current);return()=>observer.disconnect();},[]);
 return <><button onClick={()=>{window.admission.previousStarted=performance.now();windowed.older();}} disabled={windowed.loading}>이전 대화 보기</button><div className="nubi-conversation-scroll" ref={scroll.viewport} aria-busy={windowed.loading} onWheel={scroll.onUserScroll} onScroll={scroll.onScroll} style={{height:500,overflow:'auto',overflowAnchor:'none'}}><div ref={scroll.content}>
 {messages.slice(windowed.start).map(m=><article key={m.id} className="nubi-message" data-message-key={m.id} style={{height:180}}>합성 메시지 {m.id}</article>)}
 </div></div></>;
}
function Fixture(){const [open,setOpen]=useState(false);return <><h1>현재 작업</h1><input aria-label="초안"/><button onClick={()=>{window.admission.started=performance.now();setOpen(true);}}>열기</button>{open&&<Conversation/>}</>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
