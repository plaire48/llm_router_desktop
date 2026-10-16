import React,{useEffect,useRef,useState} from 'react';
import {DetailPanel} from './DetailPanel';
import {ActionButton} from './ActionButton';
import {Icon} from './Icon';
import {confirmAction} from './confirmAction';
import {notifyToast} from './Toast';
import {TALK_TEAMS,teamNoticeTargets} from './talkTeamNotices';
import {refreshTalkNotifications} from './talkNotificationRefresh';
import './talk-team-notice.css';

export function TalkTeamReceipt({body,children}){
 const targets=teamNoticeTargets(body);
 return targets.length?<p className="talk-team-receipt"><Icon name="users" size={16}/><span>{TALK_TEAMS.filter(team=>targets.includes(team.slug)).map(team=>team.label).join(', ')} 팀에 글을 공유했습니다.</span></p>:children;
}

export function TalkTeamNotice({post,client,onClose,onSent}){
 const resume=useRef(client.pending?.(post.number));
 const [rows,setRows]=useState([]),[selected,setSelected]=useState(resume.current?.slugs||[]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(Boolean(resume.current)),[revision,setRevision]=useState(0),id=useRef(resume.current?.id||crypto.randomUUID());
 useEffect(()=>{let active=true;setLoading(true);setError('');if(!resume.current)setSelected([]);client.options().then(value=>{if(active)setRows(value);}).catch(reason=>{if(active)setError(reason.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[client,revision]);
 const enabled=rows.filter(row=>row.enabled),all=enabled.length>0&&enabled.every(row=>selected.includes(row.slug));
 const send=async()=>{
  if(busy||!selected.length)return;
  if(!uncertain&&!await confirmAction({kind:'leave',title:'팀에 알림을 보낼까요?',message:`${rows.filter(row=>selected.includes(row.slug)).map(row=>row.label).join(', ')} 선택한 팀의 모든 구성원에게 알립니다.`,confirmLabel:'알림 보내기',cancelLabel:'취소'}))return;
  setBusy(true);try{await client.send({number:post.number,slugs:selected,id:id.current});refreshTalkNotifications();notifyToast('팀 알림을 등록했습니다.',{source:'talk-team'});onSent();onClose();}catch(reason){setUncertain(Boolean(reason.uncertain));notifyToast(reason,{source:'talk-team',error:true});}finally{setBusy(false);}
 };
 return <DetailPanel titleIcon="bell" title="팀 알림" variant="modal" className="talk-team-notice" helpTopic="talk" busy={busy} onClose={onClose} footer={<ActionButton action="teamNotify" label={uncertain?'결과 확인':'알림 보내기'} iconOnly={false} className="cx-button--primary" busy={busy} disabled={loading||Boolean(error)||!selected.length} onClick={send}/>}>
  <strong className="talk-team-post">{post.title}</strong>
  <div className="talk-team-toolbar"><label><input className="cx-checkbox" type="checkbox" checked={all} ref={node=>{if(node)node.indeterminate=selected.length>0&&!all;}} disabled={loading||busy||uncertain||!enabled.length} onChange={()=>setSelected(all?[]:enabled.map(row=>row.slug))}/>전체 선택</label><ActionButton action="refresh" disabled={loading||busy||uncertain} onClick={()=>setRevision(v=>v+1)}/></div>
  {loading?<p role="status">팀을 불러오는 중…</p>:error?<p role="alert">{error}</p>:<div className="talk-team-options">{rows.map(row=><label key={row.slug} className={selected.includes(row.slug)?'is-selected':''}><input className="cx-checkbox" type="checkbox" checked={selected.includes(row.slug)} disabled={!row.enabled||busy||uncertain} onChange={()=>setSelected(value=>value.includes(row.slug)?value.filter(slug=>slug!==row.slug):[...value,row.slug])}/><Icon name="users" size={20}/><span><strong>{row.label}</strong>{row.reason&&<small>{row.reason}</small>}</span>{row.count!==null&&row.count!==undefined&&<small>{row.count}명</small>}</label>)}</div>}
  <p className="talk-team-note">이메일은 GHES 수신 설정을 따릅니다. 본인 메일은 Your own updates도 켜야 합니다.</p>
 </DetailPanel>;
}
