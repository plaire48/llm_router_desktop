import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useConversationScroll} from '../ui/useConversationScroll.js';
function Fixture(){
 const [messages,setMessages]=useState(Array.from({length:12},(_,i)=>({id:String(i),text:'이전 메시지 '+i}))),[lines,setLines]=useState(0),[receipt,setReceipt]=useState(false);
 const scroll=useConversationScroll('same-task');
 window.scrollFixture={send:()=>{scroll.followNewTurn();setMessages(m=>[...m,{id:'new',text:'이어서 요청'}]);},grow:()=>setLines(n=>n+10),receipt:()=>setReceipt(true),latest:scroll.followLatest};
 return <><div ref={scroll.viewport} className="viewport" onScroll={scroll.onScroll} onWheel={scroll.onUserScroll} onTouchStart={scroll.onUserScroll} style={{height:500,overflow:'auto',overflowAnchor:'none'}}>
 <div ref={scroll.content}>{messages.map(m=><article className="message-user" data-message-key={m.id} key={m.id} style={{padding:24,margin:0,minHeight:52}}>{m.text}{m.id==='new'&&receipt?' 접수됨':''}</article>)}<div>{Array.from({length:lines},(_,i)=><p key={i}>진행 결과 {i}</p>)}</div></div>
 </div><button onClick={scroll.followLatest}>최신으로</button></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
