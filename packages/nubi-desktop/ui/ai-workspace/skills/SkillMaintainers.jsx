import React,{useEffect,useId,useRef,useState} from 'react';
import {ActionButton} from '../ActionButton';
import {ProfileIdentity} from '../AccountProfile';
import {SearchField} from '../SearchField';
import {UserIdentity} from '../UserIdentity';
import {githubIdentityLabel} from '../githubIdentity';
import {E2E_ROLES} from '../adminClient';
import {SKILL_MANAGER_LIMIT,skillManagerLogins} from './skillModel';

const canMaintainSkill=user=>!user?.permissionIssue&&Boolean(user?.login)&&E2E_ROLES.some(role=>role.key===user.role);
export function SkillMaintainers({client,value,onChange,ownerLogin,canEdit,disabled,invalid,describedBy,isEligible=canMaintainSkill,fieldName='maintainers'}) {
  const id=useId(),input=useRef(null);
  const [query,setQuery]=useState(''),[users,setUsers]=useState([]),[known,setKnown]=useState({});
  const [cursor,setCursor]=useState(null),[next,setNext]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0),[composing,setComposing]=useState(false);
  const managers=skillManagerLogins({createdBy:ownerLogin,maintainers:value}),full=managers.length>=SKILL_MANAGER_LIMIT;
  useEffect(()=>{
    if(!canEdit||disabled||full||!query.trim()||composing){setLoading(false);return;}
    const controller=new AbortController();setLoading(true);setError('');
    const timer=setTimeout(async()=>{
      try{
        const result=await client.searchMaintainers(query,{after:cursor,signal:controller.signal});
        if(controller.signal.aborted)return;
        setUsers(previous=>cursor?[...new Map([...previous,...result.users].map(user=>[user.id,user])).values()]:result.users);
        setKnown(previous=>({...previous,...Object.fromEntries(result.users.map(user=>[user.login.toLowerCase(),user]))}));
        setNext(result.next);
      }catch(reason){if(!controller.signal.aborted)setError(reason.message);}
      finally{if(!controller.signal.aborted)setLoading(false);}
    },300);
    return()=>{clearTimeout(timer);controller.abort();};
  },[client,query,cursor,revision,composing,canEdit,disabled,full]);
  const search=nextQuery=>{setQuery(nextQuery);setUsers([]);setCursor(null);setNext(null);setError('');};
  const selected=new Set(managers);
  const choose=user=>{
    if(!canEdit||disabled||selected.has(user.login.toLowerCase())||full||!isEligible(user))return;
    onChange([...value,user.login.toLowerCase()]);search('');input.current?.focus();
  };
  return <section className="skill-maintainers" aria-labelledby={`${id}-label`}>
    <div className="skill-maintainers-heading"><label id={`${id}-label`} htmlFor={canEdit?id:undefined}>수정 권한</label><span>{value.length}/{SKILL_MANAGER_LIMIT-1}</span></div>
    {canEdit&&<SearchField id={id} ref={input} name={fieldName} label="수정 권한 사용자 검색" placeholder="이름 또는 ID 검색" value={query} onChange={search} maxLength={100} disabled={disabled} readOnly={full} aria-invalid={invalid||undefined} aria-describedby={[`${id}-hint`,describedBy].filter(Boolean).join(' ')} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}}/>}
    <p id={`${id}-hint`} className="skill-maintainers-hint">{full?`최대 ${SKILL_MANAGER_LIMIT-1}명까지 지정할 수 있습니다.`:canEdit?'함께 수정할 사용자를 선택하세요.':'수정 권한이 있는 사용자입니다.'}</p>
    {canEdit&&!full&&query.trim()&&<div className="skill-maintainer-results" aria-busy={loading}>
      {loading&&<p role="status">사용자를 검색하는 중…</p>}
      {error&&<div className="skill-maintainer-error"><p role="alert">{error}</p><ActionButton action="refresh" label="사용자 검색 다시 시도" onClick={()=>setRevision(v=>v+1)} disabled={disabled}/></div>}
      {!loading&&!error&&!composing&&!users.length&&<p role="status">검색 결과가 없습니다.</p>}
      {!loading&&!error&&users.length>0&&<p className="visually-hidden" role="status">사용자 {users.length}명 검색됨</p>}
      {users.length>0&&<ul aria-label="수정 권한 사용자 검색 결과">{users.map(user=>{
        const login=user.login.toLowerCase(),isOwner=login===ownerLogin?.toLowerCase(),isSelected=selected.has(login),eligible=isEligible(user);
        const status=isOwner?'기본 권한':isSelected?'선택됨':user.permissionIssue?'권한 확인 필요':E2E_ROLES.find(role=>role.key===user.role)?.label||'권한 확인 필요';
        return <li key={user.id}><button type="button" className="skill-maintainer-result" disabled={disabled||loading||isOwner||isSelected||!eligible||full} onClick={()=>choose(user)} aria-label={`${githubIdentityLabel(user)} 수정 권한 부여`} aria-describedby={`${id}-email-${user.id} ${id}-role-${user.id}`}>
          <span className="skill-maintainer-person"><UserIdentity user={user}/><span id={`${id}-email-${user.id}`} className="skill-maintainer-email">{user.email|| (user.emailUnavailable?'이메일 조회 불가':'이메일 비공개 또는 미등록')}</span></span><span id={`${id}-role-${user.id}`} className="skill-maintainer-role">{status}</span>
        </button></li>;
      })}</ul>}
      {next&&!error&&<ActionButton action="loadMore" iconOnly={false} label="사용자 더 보기" disabled={disabled||loading} onClick={()=>setCursor(next)}/>}
    </div>}
    {value.length>0&&<ul className="skill-maintainer-selected" aria-label="수정 가능한 사용자">{managers.filter(login=>login!==ownerLogin?.toLowerCase()).map(login=><li key={login}><ProfileIdentity user={known[login]||{login}}/>{canEdit&&<ActionButton action="clearSelection" label={`${login} 수정 권한 해제`} disabled={disabled} onClick={()=>onChange(value.filter(item=>item.toLowerCase()!==login))}/>}</li>)}</ul>}
  </section>;
}
