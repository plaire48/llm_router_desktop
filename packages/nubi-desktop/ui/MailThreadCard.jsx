import React,{useEffect,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {mailDate} from './MailMatchText.jsx';
import './mail-thread-card.css';
export function MailThreadCard({id,sourceHash,api,onOpen}){
 const [packet,setPacket]=useState(null),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0),[failed,setFailed]=useState(false),[busy,setBusy]=useState(true);
 useEffect(()=>{let live=true;setBusy(true);setFailed(false);
  Promise.resolve().then(()=>api('mail',{action:'threadCard',id,offset,limit:20})).then(value=>{if(live)setPacket(value?.count?value:null);}).catch(()=>{if(live)setFailed(true);}).finally(()=>{if(live)setBusy(false);});
  return()=>{live=false;};
 },[id,sourceHash,api,offset,retry]);
 if(!packet&&!failed)return null;
 return <details className="nubi-mail-thread-card" aria-busy={busy}>
  <summary><Icon name="message" size={18}/><span>메일 대화{packet?` ${packet.count}통`:''}</span><Icon name="chevronDown" size={14}/></summary>
  {failed?<div className="nubi-mail-thread-detail"><p>대화를 불러오지 못했어요.</p><CxButton onClick={()=>setRetry(n=>n+1)}>다시 확인</CxButton></div>:<div className="nubi-mail-thread-detail">
   <dl><div><dt>참여자</dt><dd>{packet.participants.join(', ')||'미확인'}{packet.participantsTruncated?' 외 참여자':''}</dd></div>
    <div><dt>기간</dt><dd>{mailDate(packet.firstAt)} — {mailDate(packet.lastAt)}</dd></div>
    <div><dt>첨부</dt><dd>{packet.attachmentCount===null?'확인 전':`${packet.attachmentCount}개`}</dd></div>
    <div><dt>최근 메일</dt><dd>{packet.state==='saved'?'위키 정리됨':packet.state==='attention'?'정리 확인 필요':'정리 대기'}</dd></div></dl>
   {packet.grouping==='subject'&&<p className="nubi-muted">확인된 제목으로 묶었어요. 참조 헤더 확인 전인 메일이 포함될 수 있어요.</p>}
   <ul aria-label="같은 대화의 메일">{packet.items.map(item=><li key={item.id}><CxButton aria-current={item.id===id?'true':undefined} disabled={busy||item.id===id} onClick={()=>onOpen(item.id,item.sourceHash)}><span>{item.subject||'제목 없음'}</span><time>{mailDate(item.date)}</time></CxButton></li>)}</ul>
   {(offset>0||packet.hasMore)&&<nav aria-label="대화 메일 페이지"><CxButton aria-label="이전 대화 메일" disabled={busy||offset===0} onClick={()=>setOffset(n=>Math.max(0,n-20))}><Icon name="chevronLeft" size={16}/></CxButton><span>{offset+1}–{offset+packet.items.length} / {packet.count}</span><CxButton aria-label="다음 대화 메일" disabled={busy||!packet.hasMore} onClick={()=>setOffset(n=>n+20)}><Icon name="chevronRight" size={16}/></CxButton></nav>}
  </div>}
 </details>;
}
