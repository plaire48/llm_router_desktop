import React,{useEffect,useMemo,useState} from 'react';
import {AccountProvider} from './ai-workspace/AccountProfile.jsx';
import {createAdminClient} from './ai-workspace/adminClient.js';
import {setHostSession} from './ai-workspace/session.js';
import {LinkWorkspace} from './ai-workspace/workspace/LinkWorkspace.jsx';
import {CompanySkillSignIn} from './CompanySkillSignIn.jsx';
import {LoadingNote} from './LoadingNote.jsx';
import './ai-workspace-embed.css';
const E2ETalk=React.lazy(()=>import('./ai-workspace/E2ETalk.jsx'));
// The AI Workspace screens (apps with link or file registration, Talk with its editor) are the ai_workspace sources
// themselves, mounted here with the host's SSO session (user decision 2026-10-14: the same screens, not a copy).
export function AiWorkspaceEmbed({view,account,onSignIn}){
 const profile=account?.connected?account.profile:null;
 const user=useMemo(()=>profile?.login?{id:profile.id,login:profile.login,name:profile.name||profile.login,avatar_url:profile.avatar||undefined,html_url:profile.url||undefined,email:profile.email||undefined}:null,[profile?.id,profile?.login,profile?.name,profile?.avatar,profile?.email,profile?.url]);
 useEffect(()=>{setHostSession(user);return()=>setHostSession(null);},[user]);
 const [role,setRole]=useState(null);
 useEffect(()=>{let active=true;setRole(null);if(!user?.login)return;try{createAdminClient().role().then(value=>{if(active)setRole(value);}).catch(()=>{if(active)setRole('user');});}catch{setRole('user');}return()=>{active=false;};},[user?.id,user?.login]);
 if(!user)return <section className="nubi-community" aria-label={view==='talk'?'Talk':'앱 목록'}><CompanySkillSignIn onConnect={onSignIn}/></section>;
 return <div className="nubi-ai-workspace-embed" data-view={view}><AccountProvider user={user}>
  {view==='talk'?<React.Suspense fallback={<LoadingNote>Talk을 불러오는 중</LoadingNote>}><E2ETalk key={user.login} user={user} role={role||'user'}/></React.Suspense>:<LinkWorkspace key={user.login} user={user} role={role||'user'}/>}
 </AccountProvider></div>;
}
