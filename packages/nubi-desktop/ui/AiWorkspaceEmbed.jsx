import React,{useEffect,useMemo,useState} from 'react';
import {AccountProvider} from './ai-workspace/AccountProfile.jsx';
import {WorkspaceMemory} from './ai-workspace/WorkspaceMemory.jsx';
import {createAdminClient} from './ai-workspace/adminClient.js';
import {setHostSession} from './ai-workspace/session.js';
import {LinkWorkspace} from './ai-workspace/workspace/LinkWorkspace.jsx';
import {CompanySkillSignIn} from './CompanySkillSignIn.jsx';
import {LoadingNote} from './LoadingNote.jsx';
import './ai-workspace-embed.css';
const E2ETalk=React.lazy(()=>import('./ai-workspace/E2ETalk.jsx'));
const InquiryWorkspace=React.lazy(()=>import('./ai-workspace/InquiryWorkspace.jsx'));
const VIEW_LABEL={talk:'Talk',support:'문의',apps:'앱 목록'};
// The AI Workspace screens (apps with link or file registration, Talk with its editor) are the ai_workspace sources
// themselves, mounted here with the host's SSO session (user decision 2026-10-14: the same screens, not a copy).
export function AiWorkspaceEmbed({view,account,onSignIn}){
 const profile=account?.connected?account.profile:null;
 // The signed-in person's GHES status emoji rides along so their own photo shows it too (2026-10-14).
 const statusEmoji=profile?.status?.emoji||'',statusMessage=profile?.status?.message||'';
 const user=useMemo(()=>profile?.login?{id:profile.id,login:profile.login,name:profile.name||profile.login,avatar_url:profile.avatar||undefined,html_url:profile.url||undefined,email:profile.email||undefined,...(statusEmoji?{status:{emoji:statusEmoji,message:statusMessage}}:{})}:null,[profile?.id,profile?.login,profile?.name,profile?.avatar,profile?.email,profile?.url,statusEmoji,statusMessage]);
 // The ported screens read the session while they first render (their clients are created then), so it is set before
 // they render, not in an effect afterwards: set late, the app list read itself as signed out and failed with
 // "연결을 확인하고 다시 불러오세요" (user report 2026-10-14). Setting it again is harmless.
 setHostSession(user);
 useEffect(()=>{setHostSession(user);return()=>setHostSession(null);},[user]);
 const [role,setRole]=useState(null);
 useEffect(()=>{let active=true;setRole(null);if(!user?.login)return;try{createAdminClient().role().then(value=>{if(active)setRole(value);}).catch(()=>{if(active)setRole('user');});}catch{setRole('user');}return()=>{active=false;};},[user?.id,user?.login]);
 // The inquiry screen reads its route from the hash (user request 2026-10-14); it is set while mounted and cleared after.
 useEffect(()=>{if(view!=='support')return;const previous=location.hash;if(!/^#support/.test(previous))history.replaceState(null,'','#support');return()=>{if(/^#support/.test(location.hash))history.replaceState(null,'',location.pathname+location.search);};},[view]);
 if(!user)return <section className="nubi-community" aria-label={VIEW_LABEL[view]||'앱 목록'}><CompanySkillSignIn onConnect={onSignIn}/></section>;
 // The same providers as the AI Workspace web app wraps its screens in (view state memory, account).
 return <div className="nubi-ai-workspace-embed" data-view={view}><WorkspaceMemory><AccountProvider user={user}>
  {view==='talk'?<React.Suspense fallback={<LoadingNote>Talk을 불러오는 중</LoadingNote>}><E2ETalk key={user.login} user={user} role={role||'user'}/></React.Suspense>:view==='support'?<React.Suspense fallback={<LoadingNote>문의를 불러오는 중</LoadingNote>}><InquiryWorkspace key={user.login} user={user} role={role||'user'}/></React.Suspense>:<LinkWorkspace key={user.login} user={user} role={role||'user'}/>}
 </AccountProvider></WorkspaceMemory></div>;
}
