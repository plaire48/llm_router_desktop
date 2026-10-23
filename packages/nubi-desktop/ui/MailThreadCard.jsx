import React,{useEffect,useState,useRef} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {mailDate} from './MailMatchText.jsx';
import './mail-thread-card.css';
export function MailThreadCard({id,sourceHash,api,onOpen}){
 const [packet,setPacket]=useState(null),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0),[failed,setFailed]=useState(false),[busy,setBusy]=useState(true);
 const [topic,setTopic]=useState(null),[organizing,setOrganizing]=useState(false),[topicError,setTopicError]=useState(''),generation=useRef(0);
 useEffect(()=>{generation.current++;setTopic(null);setTopicError('');setOrganizing(false);return()=>{generation.current++;};},[id,sourceHash]);
 async function organize(){const run=++generation.current;setOrganizing(true);setTopicError('');try{const value=await api('mail',{action:'topicWiki',id,sourceHash});if(generation.current===run)setTopic(value);}catch(error){if(generation.current===run)setTopicError(error.message==='mail_model_missing'?'정리할 모델을 연결해 주세요.':error.message==='mail_source_changed'?'원문이 바뀌었어요. 다시 열어 확인해 주세요.':error.message==='mail_encryption_unavailable'?'안전한 저장소를 사용할 수 없어요. 앱을 다시 열어 확인해 주세요.':'대화 위키를 저장하지 못했어요. 원문과 모델 연결을 확인해 주세요.');}finally{if(generation.current===run)setOrganizing(false);}}
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
    <div><dt>최근 메일</dt><dd>{packet.state==='saved'?'위키 정리됨':packet.state==='indexed'?'검색 준비됨':packet.state==='attention'?'정리 확인 필요':'정리 대기'}</dd></div></dl>
   <CxButton disabled={busy||organizing} onClick={organize}><Icon name="book" size={16}/>{organizing?'원문을 대조하며 정리 중':'대화를 위키로 정리'}</CxButton>
   {topicError&&<p role="alert">{topicError}</p>}
   {topic&&<div role="status"><p>{topic.summary}</p><small>{topic.coverage?.messages}/{topic.coverage?.totalMessages}통 기준{topic.coverage?.complete?'':' / 일부 범위 확인'}로 위키에 저장했어요.</small></div>}
   {packet.grouping==='subject'&&<p className="nubi-muted">확인된 제목으로 묶었어요. 참조 헤더 확인 전인 메일이 포함될 수 있어요.</p>}
   <ul aria-label="같은 대화의 메일">{packet.items.map(item=><li key={item.id}><CxButton aria-current={item.id===id?'true':undefined} disabled={busy||item.id===id} onClick={()=>onOpen(item.id,item.sourceHash)}><span>{item.subject||'제목 없음'}</span><time>{mailDate(item.date)}</time></CxButton></li>)}</ul>
   {(offset>0||packet.hasMore)&&<nav aria-label="대화 메일 페이지"><CxButton aria-label="이전 대화 메일" disabled={busy||offset===0} onClick={()=>setOffset(n=>Math.max(0,n-20))}><Icon name="chevronLeft" size={16}/></CxButton><span>{offset+1}–{offset+packet.items.length} / {packet.count}</span><CxButton aria-label="다음 대화 메일" disabled={busy||!packet.hasMore} onClick={()=>setOffset(n=>n+20)}><Icon name="chevronRight" size={16}/></CxButton></nav>}
  </div>}
 </details>;
}
