import {ProfileTooltip,usePublicProfileHover} from './ProfileTooltip';
import React, { createContext, useContext, useEffect, useMemo, useState, useId } from 'react';
import { DetailPanel } from './DetailPanel';
import { Icon } from './Icon';
import { githubDisplayIdentity, githubIdentityLabel } from './githubIdentity';
import {createProfileClient} from './profileClient';
import {E2E_ROLES} from './adminClient';
import {ActionButton,ActionLink} from './ActionButton';
import {GithubAvatar} from './GithubAvatar';
import {UserIdentity} from './UserIdentity';
export {GithubAvatar} from './GithubAvatar';
import './account-profile.css';

const Account = createContext(null);
export const useAccount = () => useContext(Account);
export function useGithubProfileReader(fallback) {
  const client=useAccount()?.profileClient;
  return useMemo(()=>client?.read?login=>client.read({login}):fallback,[client,fallback]);
}

// Identity comes from GHES login. There is no separate personal profile store.
export function AccountProvider({ user, children, profileClient:providedClient }) {
  const profileClient=useMemo(()=>providedClient||createProfileClient(),[providedClient,user?.id,user?.login]);
  useEffect(()=>()=>{if(!providedClient)profileClient.dispose();},[profileClient,providedClient]);
  return <Account.Provider value={{user:githubDisplayIdentity(user),profileClient}}>{children}</Account.Provider>;
}

export function AccountProfile({ onClose, client }) {
  const {user,profileClient} = useAccount();
  return <GithubProfilePanel account={user} title="내 프로필" onClose={onClose} client={client||profileClient}/>;
}

export function ProfileIdentity({user,size='sm',resolve=true}) {
  const account=useAccount(),client=account?.profileClient;
  const [open,setOpen]=useState(false),[resolved,setResolved]=useState(null),id=useId();
  const key=`${user?.id??''}:${user?.login||''}`;
  useEffect(()=>{
    let active=true;setOpen(false);setResolved(null);
    if(resolve&&client?.read&&user?.login)client.read(user).then(value=>{if(active&&value)setResolved({key,client,value});}).catch(()=>{});
    return()=>{active=false;};
  },[key,client,resolve]);
  const identity=resolved?.key===key&&resolved.client===client?{...user,...resolved.value}:user;
  const hover=usePublicProfileHover(identity,client);
  return <><button type="button" className="profile-identity-button" {...(identity?.id?hover.handlers:{})} aria-describedby={hover.card?id:undefined} disabled={!identity?.login} aria-label={`${githubIdentityLabel(identity)} 프로필 보기`} onClick={event=>{event.currentTarget.focus();hover.close();setOpen(true);}}><UserIdentity user={identity} size={size}/></button>{hover.card&&<ProfileTooltip id={id} {...hover.card} onMouseEnter={hover.keep} onMouseLeave={hover.leave}/>} {open&&<GithubProfilePanel account={identity} client={client} onClose={()=>setOpen(false)}/>}</>;
}

export function GithubProfilePanel({account,title='프로필',onClose,client:providedClient}) {
  const context=useAccount(),accountClient=context?.profileClient;
  const [profile,setProfile]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
  const client=useMemo(()=>providedClient||accountClient||createProfileClient(),[providedClient,accountClient,account?.id,account?.login,revision]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');setProfile(null);
    client.load(account,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setProfile(value);}).catch(reason=>{if(!controller.signal.aborted)setError(reason.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[client,account?.id,account?.login,revision]);
  const identity=profile||account,role=E2E_ROLES.find(item=>item.key===profile?.role)?.label;
  const hasBasicInfo=Boolean(profile?.company||profile?.email||profile?.location||profile?.blog);
  const profileActions=profile&&<div className="profile-section-actions"><ActionButton action="refresh" label="프로필 새로고침" onClick={()=>setRevision(value=>value+1)}/>{profile.html_url&&<ActionLink action={profile.own?"edit":"openExternal"} label={profile.own?"GitHub 프로필 수정":"GitHub에서 보기"} className="profile-github-link" href={profile.own?`https://${new URL(profile.html_url).host}/settings/profile`:profile.html_url} target="_blank" rel="noopener noreferrer"/>}</div>;
  return <DetailPanel helpTopic="account" title={title} onClose={onClose} className="account-profile-panel">
    <div className="profile-hero"><GithubAvatar user={identity} size="lg"/><div className="profile-heading"><h3>{identity?.name||identity?.login}</h3>{identity?.login&&<span className="profile-login">@{identity.login}</span>}{role&&<span className="profile-role">{role}</span>}</div></div>
    {loading?<div className="profile-feedback" role="status"><span className="status-spinner" aria-hidden="true"/>프로필을 불러오는 중…</div>:error?<div className="profile-feedback is-error" role="alert"><p>{error}</p><ActionButton action="refresh" label="프로필 다시 불러오기" onClick={()=>setRevision(value=>value+1)}/></div>:profile&&<>
      {profile.bio&&<p className="account-bio">{profile.bio}</p>}
      {hasBasicInfo?<section className="profile-section"><div className="profile-section-heading"><h3>기본 정보</h3>{profileActions}</div><dl className="profile-facts">
        {profile.company&&<div><dt>소속</dt><dd>{profile.company}</dd></div>}
        {profile.email&&<div><dt>이메일</dt><dd><a href={`mailto:${encodeURIComponent(profile.email)}`}>{profile.email}</a></dd></div>}
        {profile.location&&<div><dt>위치</dt><dd>{profile.location}</dd></div>}
        {profile.blog&&<div><dt>웹사이트</dt><dd><a href={profile.blog} target="_blank" rel="noopener noreferrer">{profile.blog.replace(/^https?:\/\//,'')}</a></dd></div>}
      </dl></section>:<div className="profile-empty-actions">{profileActions}</div>}
      {profile.socials.length>0&&<section className="profile-section"><div className="profile-section-heading"><h3>소셜 계정</h3></div><ul className="profile-social-list">{profile.socials.map(item=><li key={item.url}><a href={item.url} target="_blank" rel="noopener noreferrer"><Icon name="link" size={16}/><span>{item.provider||new URL(item.url).hostname}<small>{item.url.replace(/^https?:\/\//,'')}</small></span><Icon name="linkExternal" size={16}/></a></li>)}</ul></section>}
    </>}
  </DetailPanel>;
}
