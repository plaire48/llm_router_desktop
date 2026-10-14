import React,{useEffect,useRef,useState} from 'react';
import {DetailPanel} from './DetailPanel';
import {ActionButton} from './ActionButton';
import {SearchField} from './SearchField';
import {GithubAvatar} from './AccountProfile';
import {githubIdentityLabel} from './githubIdentity';
import {E2E_ROLES,GHES_TEAMS_URL} from './adminClient';
import {confirmAction} from './confirmAction';
import {notifyToast} from './Toast';
import {GithubRequestError} from './GithubRequestError';
const roleLabel=role=>E2E_ROLES.find(r=>r.key===role)?.label||'권한 확인 필요';
export function TeamAssignment({client,initialUser,onClose,onSaved,onBusy}) {
 const [users,setUsers]=useState([]),[query,setQuery]=useState(''),[selection,setSelection]=useState(initialUser||null),[detail,setDetail]=useState(null),[desired,setDesired]=useState({});
 const [loading,setLoading]=useState(Boolean(initialUser)),[error,setError]=useState(''),[revision,setRevision]=useState(0),[saving,setSaving]=useState(false),[uncertain,setUncertain]=useState(false),[result,setResult]=useState(null),[noticeError,setNoticeError]=useState(null);
 const operation=useRef(null),notice=useRef(null);
 const dirty=Boolean(detail&&detail.teams.some(t=>Boolean(t.membership)!==desired[t.key]));
 const [cursor,setCursor]=useState(null),[next,setNext]=useState(null),[composing,setComposing]=useState(false);
 useEffect(()=>{if(!selection)return;let current=true;setLoading(true);setError('');setDetail(null);
  client.teamUser(selection.id).then(value=>{if(current){setDetail(value);setDesired(Object.fromEntries(value.teams.map(t=>[t.key,Boolean(t.membership)])));}}).catch(reason=>{if(current)setError(reason);}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};
 },[client,selection,revision]);
 useEffect(()=>{
  if(selection)return;
  if(!query.trim()||composing){setLoading(false);return;}
  const controller=new AbortController();setLoading(true);setError('');
  const timer=setTimeout(()=>client.searchTeamUsers(query,{after:cursor,signal:controller.signal}).then(value=>{
   if(controller.signal.aborted)return;
   setUsers(current=>cursor?[...new Map([...current,...value.users].map(user=>[user.id,user])).values()]:value.users);setNext(value.next);
  }).catch(reason=>{if(!controller.signal.aborted)setError(reason);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);}),350);
  return()=>{clearTimeout(timer);controller.abort();};
 },[client,selection,query,cursor,revision,composing]);
 const search=value=>{setQuery(value);setCursor(null);setNext(null);setUsers([]);setError('');};
 const back=async()=>{if(saving||dirty&&!result&&!await confirmAction({kind:'leave',title:uncertain?'팀 변경 여부를 확인하지 못했습니다.':'검색 결과로 돌아갈까요?',message:uncertain?'검색으로 돌아간 뒤 최신 팀 소속을 다시 확인하세요.':'선택한 팀 변경은 저장되지 않습니다.',confirmLabel:'돌아가기',cancelLabel:'계속 수정'}))return;setSelection(null);setDetail(null);setResult(null);setUncertain(false);setNoticeError(null);operation.current=null;notice.current=null;};
 useEffect(()=>{onBusy?.(saving);return()=>onBusy?.(false);},[saving,onBusy]);
 const close=async()=>{if(saving)return;if(dirty&&!result&&!await confirmAction({kind:'leave',title:uncertain?'팀 변경 여부를 확인하지 못했습니다.':'저장하지 않고 닫을까요?',message:uncertain?'닫은 뒤 사용자 목록을 새로고침해 소속을 확인하세요.':'선택한 팀 변경은 반영되지 않습니다.',confirmLabel:uncertain?'닫기':'저장하지 않고 닫기',cancelLabel:uncertain?'계속 확인':'계속 수정'}))return;onClose();};
 const sendNotice=async (actual,teamChanges=[])=>{
  if(actual.permissionIssue){setNoticeError({message:'권한을 확인하지 못해 알림을 보내지 않았습니다.',retry:false});return;}
  if(!notice.current)notice.current={userId:actual.id,role:actual.role,id:crypto.randomUUID(),teamChanges};
  try{await client.sendRoleNotice(notice.current);setNoticeError(null);onSaved?.(actual,{teamChanges:notice.current.teamChanges});}catch(reason){setNoticeError({message:reason.noticeCreated?'권한 알림은 등록했지만 Role 레이블을 반영하지 못했습니다.':reason.uncertain?'권한 알림 등록 결과를 확인하지 못했습니다.':'팀 변경은 완료했지만 권한 알림을 보내지 못했습니다.',retry:true});}
 };
 const save=async()=>{
  if(saving||!detail||!dirty)return;
  if(!uncertain){
   const add=detail.teams.filter(t=>!t.membership&&desired[t.key]).map(t=>t.label),remove=detail.teams.filter(t=>t.membership&&!desired[t.key]).map(t=>t.label);
   if(!await confirmAction({kind:'info',title:'팀 소속을 변경할까요?',message:[githubIdentityLabel(detail.user),`현재 권한: ${roleLabel(detail.user.role)}`,add.length?`추가: ${add.join(', ')}`:'',remove.length?`제거: ${remove.join(', ')}`:'',detail.requiresInvitation&&add.length?'조직에 초대합니다. 수락 후 팀 권한이 적용됩니다.':'','다른 팀이나 개인 권한은 유지됩니다.'].filter(Boolean).join('\n'),confirmLabel:'변경',cancelLabel:'취소'}))return;
   operation.current={userId:detail.user.id,baseline:Object.fromEntries(detail.teams.map(t=>[t.key,t.membership])),desired:{...desired},id:crypto.randomUUID()};
  }
  setSaving(true);
  try{const saved=await client.saveTeamUser(operation.current);setResult(saved);setUncertain(false);onSaved?.(saved.user,saved);notifyToast(saved.pendingTeams?.length?'팀 초대가 등록되었습니다.':saved.changed?'팀 소속을 반영했습니다.':'변경 사항이 없습니다.',{source:'team-membership'});if(saved.changed&&!saved.pendingTeams?.length)await sendNotice(saved.user,saved.teamChanges);}
  catch(reason){setUncertain(Boolean(reason.uncertain));if(!reason.uncertain)operation.current=null;notifyToast(reason,{source:'team-membership',error:true});if(reason.partial&&!reason.uncertain){setRevision(v=>v+1);onSaved?.(undefined,{teamChanges:reason.teamChanges});}}
  finally{setSaving(false);}
 };
 const expected=desired.system?'system':desired.editor?'editor':'user';
 return <DetailPanel title={initialUser?"팀 소속 수정":"사용자 추가"} variant="modal" className="admin-account-modal team-assignment-panel" helpTopic="admin" busy={saving} onClose={close} footer={!result&&detail?<ActionButton action={uncertain?'refresh':'save'} iconOnly={false} label={uncertain?'결과 확인':'저장'} busy={saving} disabled={loading||!dirty} onClick={save}/>:undefined}>
  {!selection?<><div className="team-assignment-search"><SearchField label="사내 사용자 검색" placeholder="이름 또는 아이디 검색" value={query} maxLength={100} onChange={search} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)}/><ActionButton action="refresh" label="사용자 검색 새로고침" busy={loading} disabled={!query.trim()} onClick={()=>{setCursor(null);setRevision(v=>v+1);}}/></div>
   <ul className="admin-directory" aria-label="사용자 검색 결과">{users.map(user=><li key={user.id}><button type="button" onClick={()=>setSelection(user)}><span className="admin-identity"><GithubAvatar user={user} size="sm"/><span>{githubIdentityLabel(user)}<small className="admin-email">{user.email||(user.emailUnavailable?'이메일 조회 불가':'이메일 비공개 또는 미등록')}</small></span></span></button></li>)}</ul>
   {!loading&&!error&&!users.length&&<p className="admin-empty">{query.trim()?'검색 결과가 없습니다.':'이름 또는 아이디로 검색하세요.'}</p>}{next&&!error&&<ActionButton action="loadMore" label="검색 결과 더 보기" busy={loading} onClick={()=>setCursor(next)}/>}</>:null}
  {selection&&!initialUser&&<ActionButton action="back" label="검색 결과로" disabled={saving} onClick={back}/>}
  {detail&&<><div className="team-assignment-person"><div className="team-assignment-person-heading"><span className="admin-identity"><GithubAvatar user={detail.user} size="md"/><span>{githubIdentityLabel(detail.user)}<small className="admin-email">{detail.user.email||'이메일 비공개 또는 미등록'}</small></span></span>{!result&&<ActionButton action="refresh" label="팀 소속 새로고침" disabled={saving||uncertain} onClick={async()=>{if(dirty&&!await confirmAction({kind:'reset',title:'최신 소속을 다시 불러올까요?',message:'선택한 변경 내용은 초기화됩니다.',confirmLabel:'다시 불러오기',cancelLabel:'계속 수정'}))return;setRevision(v=>v+1);}}/>}</div><span className="team-current-role">현재 권한 <strong>{roleLabel(result?.user?.role||detail.user.role)}</strong></span></div>
   {!result?<><fieldset className="team-assignment-choices" disabled={saving||uncertain}><legend>팀 소속</legend>{detail.teams.map(team=><label key={team.key} title={!team.editable?(detail.requiresInvitation?'조직 Owner만 새 조직 사용자를 초대할 수 있습니다.':'조직 소유자 또는 해당 팀의 Maintainer가 변경할 수 있습니다.'):undefined}><input type="checkbox" checked={Boolean(desired[team.key])} disabled={!team.editable} onChange={event=>setDesired(v=>({...v,[team.key]:event.target.checked}))}/><span>{team.label}</span>{team.membership?.state==='pending'&&<small>초대 대기</small>}</label>)}</fieldset><p className="admin-note">체크를 해제하고 저장하면 팀에서 제외됩니다.</p></>:<div className="team-assignment-result" role="status"><strong>{result.pendingTeams?.length?'초대 대기':result.user.permissionIssue?'실제 권한 확인이 필요합니다.':result.user.role!==expected?'기존 권한이 유지됩니다.':'팀 소속을 반영했습니다.'}</strong><p>{result.pendingTeams?.length?`${result.pendingTeams.map(key=>roleLabel(key)).join(', ')} 팀 초대가 등록되었습니다. 사용자가 수락하면 권한이 적용됩니다.`:result.user.permissionIssue?'팀은 변경했습니다. 목록을 새로고침해 권한을 확인하세요.':result.user.role!==expected?`현재 권한은 ${roleLabel(result.user.role)}입니다. 다른 팀, 개인 또는 조직 권한을 GHES에서 확인하세요.`:`현재 권한: ${roleLabel(result.user.role)}`}</p>{(!result.pendingTeams?.length&&(result.user.permissionIssue||result.user.role!==expected))&&<a href={GHES_TEAMS_URL} target="_blank" rel="noopener noreferrer">GHES 팀 확인</a>}{noticeError&&<p>{noticeError.message}</p>}{noticeError?.retry&&<ActionButton action="refresh" iconOnly={false} label="알림 결과 확인" busy={saving} onClick={async()=>{setSaving(true);try{await sendNotice(result.user);}finally{setSaving(false);}}}/>}</div>}
  </>}
  {loading&&<p className="admin-empty" role="status">불러오는 중…</p>}{error&&<div><GithubRequestError error={error}/>{selection&&<ActionButton action="refresh" label="팀 정보 다시 확인" onClick={()=>setRevision(v=>v+1)}/>}</div>}
 </DetailPanel>;
}
