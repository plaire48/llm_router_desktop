import React,{useEffect,useState} from 'react';
import {Icon} from './Icon';

// One photo and fallback treatment for account panels, authors and hover cards.
export function GithubAvatar({user,size='md'}) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[user?.avatar_url]);
  const name=user?.name||user?.login||'사용자';
  return user?.avatar_url&&!failed?<img className={`github-avatar github-avatar--${size}`} src={user.avatar_url} alt={`${name} GitHub 프로필`} onError={()=>setFailed(true)} referrerPolicy="no-referrer"/>:<span className={`github-avatar github-avatar--${size} github-avatar--fallback`} aria-label={`${name} GitHub 프로필`}><Icon name="user" size={size==='lg'?24:16}/></span>;
}
