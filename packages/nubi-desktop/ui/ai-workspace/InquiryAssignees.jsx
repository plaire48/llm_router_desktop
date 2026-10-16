import React,{useEffect,useState} from 'react';
import {ActionButton} from './ActionButton';
import {DetailPanel} from './DetailPanel';
import {SearchField} from './SearchField';
import {GithubAvatar} from './AccountProfile';
import {githubIdentityLabel} from './githubIdentity';
import {notifyToast} from './Toast';
import {E2E_ROLES} from './adminClient';
import {GithubRequestError} from './GithubRequestError';

export function InquiryAssigneeOptions({rows,chosen,assigned=new Set(),disabled,onChange}) {
  return <ul className="inquiry-assignment-list" aria-label="관리자 팀 담당자">
    {rows.map(user=>{const present=assigned.has(user.login.toLowerCase());return <li key={user.id}><label><input type="checkbox" className="cx-checkbox" aria-label={`${githubIdentityLabel(user)} 배정`} checked={present||chosen.includes(user.login)} disabled={disabled||present||!chosen.includes(user.login)&&assigned.size+chosen.length>=10} onChange={event=>onChange(user,event.target.checked)}/><GithubAvatar user={user} size="sm"/><span className="inquiry-assignment-person"><strong>{githubIdentityLabel(user)}</strong><span className="inquiry-assignment-details"><span className="inquiry-assignment-role">{E2E_ROLES.find(role=>role.key===user.role)?.label||'권한 확인 필요'}</span><span className="inquiry-assignment-email">{user.email||'이메일 비공개 또는 조회 불가'}</span></span>{present&&<small>배정됨</small>}</span></label></li>;})}
  </ul>;
}

export function InquiryAssignees({post,client,onClose,onSaved,onBusy}) {
  const [rows,setRows]=useState([]),[query,setQuery]=useState(''),[chosen,setChosen]=useState([]);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const assigned=new Set(post.assignees.map(user=>user.login.toLowerCase()));
  useEffect(()=>{
    let current=true;setLoading(true);setError('');setChosen([]);
    client.candidates().then(value=>{if(current)setRows(value);}).catch(reason=>{if(current)setError(reason);}).finally(()=>{if(current)setLoading(false);});
    return()=>{current=false;};
  },[client,revision]);
  useEffect(()=>{onBusy(saving);return()=>onBusy(false);},[saving,onBusy]);
  const needle=query.trim().toLowerCase(),filtered=rows.filter(user=>`${user.name||''} ${user.login} ${user.email||''}`.toLowerCase().includes(needle));
  const save=async()=>{
    if(saving||loading||!chosen.length)return;
    setSaving(true);
    try{const result=await client.assign(post.number,chosen);onSaved(result);notifyToast('담당자를 배정했습니다.',{source:'inquiry-assignment'});}
    catch(reason){notifyToast(reason,{source:'inquiry-assignment',error:true});}
    finally{setSaving(false);}
  };
  return <DetailPanel titleIcon="users" title="담당자 배정" variant="modal" className="inquiry-assignment-panel" helpTopic="support" busy={saving} onClose={onClose} footer={<ActionButton action="save" label="배정" busy={saving} disabled={loading||Boolean(error)||!chosen.length} onClick={save}/>}>
    <div className="inquiry-assignment-toolbar"><SearchField label="담당자 검색" placeholder="이름, ID, 이메일" value={query} onChange={setQuery}/><ActionButton action="refresh" busy={loading} disabled={saving} onClick={()=>setRevision(value=>value+1)}/></div>
    {post.assignees.length>0&&<p className="inquiry-assignment-current">현재 담당자 <span>{post.assignees.map(user=>githubIdentityLabel(user)).join(', ')}</span></p>}
    <InquiryAssigneeOptions rows={filtered} chosen={chosen} assigned={assigned} disabled={saving||loading||Boolean(error)} onChange={(user,checked)=>setChosen(current=>checked?[...current,user.login]:current.filter(login=>login!==user.login))}/>
    {loading?<p className="inquiry-assignment-empty" role="status">불러오는 중…</p>:error?<GithubRequestError error={error}/>:!filtered.length&&<p className="inquiry-assignment-empty">{needle?'검색 결과가 없습니다.':'관리자 팀에 등록된 담당자가 없습니다.'}</p>}
  </DetailPanel>;
}
