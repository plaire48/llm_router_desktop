import React,{useEffect,useState} from 'react';
import {Icon} from './Icon';
import {ghesImageUrl} from './ghesImage.js';

// One photo and fallback treatment for account panels, authors and hover cards.
export function GithubAvatar({user,size='md'}) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[user?.avatar_url]);
  const name=user?.name||user?.login||'사용자';
  // The GHES profile status emoji sits small at the bottom right of the photo (user request 2026-10-14).
  const status=user?.status?.emoji?<span className="github-avatar-status" title={user.status.message||'상태'} aria-label={`상태 ${user.status.emoji}${user.status.message?' '+user.status.message:''}`}>{user.status.emoji}</span>:null;
  if(status)return <span className="github-avatar-wrap">{user?.avatar_url&&!failed?<img className={`github-avatar github-avatar--${size}`} src={ghesImageUrl(user.avatar_url)} alt={`${name} GitHub 프로필`} onError={()=>setFailed(true)} referrerPolicy="no-referrer"/>:<span className={`github-avatar github-avatar--${size} github-avatar--fallback`} aria-hidden="true">{name.slice(0,1)}</span>}{status}</span>;
  return user?.avatar_url&&!failed?<img className={`github-avatar github-avatar--${size}`} src={ghesImageUrl(user.avatar_url)} alt={`${name} GitHub 프로필`} onError={()=>setFailed(true)} referrerPolicy="no-referrer"/>:<span className={`github-avatar github-avatar--${size} github-avatar--fallback`} aria-label={`${name} GitHub 프로필`}><Icon name="user" size={size==='lg'?24:16}/></span>;
}
