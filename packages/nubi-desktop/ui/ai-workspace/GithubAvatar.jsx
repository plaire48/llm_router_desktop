import React,{useEffect,useState} from 'react';
import {Icon} from './Icon';
import {ghesImageUrl} from './ghesImage.js';

// The GHES status emoji follows the person's name, not the photo (user request 2026-10-14).
// A company custom emoji comes as an image (no Unicode); it shows through the host like the account panel does, and
// its :name: stands in when the picture cannot load, so the status is never silently missing (user report 2026-10-15).
export function StatusEmoji({user}) {
  const [failed,setFailed]=useState(false);
  const status=user?.status,emoji=status?.emoji,image=status?.image,name=status?.name;
  if(!emoji&&!image)return null;
  const message=status.message||'';
  const shown=emoji||(image&&!failed?<img src={ghesImageUrl(image)} alt="" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:`:${name||'status'}:`);
  return <span className="github-name-status" title={message||'상태'} aria-label={`상태 ${emoji||name||''}${message?' '+message:''}`}>{shown}</span>;
}
// One photo and fallback treatment for account panels, authors and hover cards.
export function GithubAvatar({user,size='md'}) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[user?.avatar_url]);
  const name=user?.name||user?.login||'사용자';
  return user?.avatar_url&&!failed?<img className={`github-avatar github-avatar--${size}`} src={ghesImageUrl(user.avatar_url)} alt={`${name} GitHub 프로필`} onError={()=>setFailed(true)} referrerPolicy="no-referrer"/>:<span className={`github-avatar github-avatar--${size} github-avatar--fallback`} aria-label={`${name} GitHub 프로필`}><Icon name="user" size={size==='lg'?24:16}/></span>;
}
