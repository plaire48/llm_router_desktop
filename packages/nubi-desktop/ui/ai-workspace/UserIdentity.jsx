import React from 'react';
import {GithubAvatar} from './GithubAvatar';
import './user-identity.css';

// A compact, shared person label for selection lists and selected recipients.
export function UserIdentity({user,chip=false,size='sm'}) {
 const name=user?.name?.trim(),login=user?.login||'';
 return <span className={`cx-person-identity${chip?' cx-person-chip':''}`}><GithubAvatar user={user} size={size}/><span className="cx-person-name">{name||login||'사용자'}</span>{name&&login&&name!==login&&<span className="cx-person-login">({login})</span>}</span>;
}
