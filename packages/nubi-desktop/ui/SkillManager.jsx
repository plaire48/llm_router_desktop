import {WorkspaceApps,WorkspaceTalk} from './WorkspaceCommunity.jsx';
import {LoadingNote} from './LoadingNote.jsx';
import {InquiryHeaderSlot} from './ai-workspace/InquiryHeaderSlot.js';
import {teamWorkspaceMark} from './TeamWorkspaceMark.js';
import React,{useEffect,useRef,useState} from 'react';
import {SkillLibrary} from './SkillLibrary.jsx';
import {Icon} from '@e2e/cx-design-system';
import {AgentTabs} from '../../../extensions/aipro-chat/src/AgentTabs.jsx';
import {WikiRepository} from './WikiRepository.jsx';

const DeferredWorkspace=React.lazy(()=>import('./AiWorkspaceEmbed.jsx').then(module=>({default:module.AiWorkspaceEmbed})));
function AiWorkspaceEmbed(props){return <React.Suspense fallback={<LoadingNote>불러오는 중</LoadingNote>}><DeferredWorkspace {...props}/></React.Suspense>;}

// The page and composer dialog share the same registration and management flow.
// In the desktop app the apps and Talk sections are the ai_workspace screens themselves (user decision 2026-10-14); the web
// fixtures keep the lightweight views, since the vendored screens talk to company GitHub through the host.
const embedded=typeof window!=='undefined'&&window.nubi?.desktop===true;
export function SkillManager({api,taskId,openPath,onBack,onRegister,connectMarketplace,initialTab,onSignIn,accountRevision,account}){
  const heading=useRef(null),[section,setSection]=useState('skills'),[inquirySlot,setInquirySlot]=useState(null);
  useEffect(()=>{heading.current?.focus();},[]);
  // No back arrow on these pages (user request 2026-10-14): the rail's icon heads the page, and the rail or Escape returns.
  const escape=event=>{if(event.key!=='Escape'||event.defaultPrevented||document.querySelector('[role="dialog"],[role="alertdialog"],.cx-panel-backdrop'))return;event.preventDefault();onBack?.();};
  // 문의 is its own page (user clarification 2026-10-14): only the inquiry screen, no Workspace section tabs.
  if(initialTab==='support')return <section className="nubi-skill-page nubi-inquiry-page" aria-label="문의" onKeyDown={escape}><header className="nubi-skill-page-header"><span className="nubi-page-mark" data-tone="blue" aria-hidden="true"><Icon name="helpCircle" size={20}/></span><h1 ref={heading} tabIndex={-1}>문의</h1><div ref={setInquirySlot} className="nubi-inquiry-header-slot"/></header><div className="nubi-skill-page-body">{embedded?<InquiryHeaderSlot.Provider value={inquirySlot}><AiWorkspaceEmbed key={accountRevision} view="support" account={account} onSignIn={onSignIn}/></InquiryHeaderSlot.Provider>:<section className="nubi-community" aria-label="문의 안내"><p>문의는 누비 Workspace 앱에서 사내 로그인 뒤 사용할 수 있어요.</p></section>}</div></section>;
  return <section className="nubi-skill-page" aria-label="AI Workspace" onKeyDown={escape}><header className="nubi-skill-page-header"><span className="nubi-page-mark" aria-hidden="true"><img className="nubi-team-mark" src={teamWorkspaceMark} alt=""/></span><h1 ref={heading} tabIndex={-1}>AI Workspace</h1></header><div className="nubi-skill-page-body"><div className="nubi-workspace-sections"><AgentTabs items={[{key:'skills',label:<><Icon name="layers" size={16}/>스킬</>},{key:'wiki',label:<><Icon name="bookmark" size={16}/>위키</>},{key:'apps',label:<><Icon name="layoutGrid02" size={16}/>앱</>},{key:'talk',label:<><Icon name="message" size={16}/>Talk</>}]} active={section} onChange={setSection} label="AI Workspace 영역" idPrefix="workspace-section"/></div>{section==='apps'?(embedded?<AiWorkspaceEmbed key={accountRevision} view="apps" account={account} onSignIn={onSignIn}/>:<WorkspaceApps key={accountRevision} api={api} onSignIn={onSignIn}/>):section==='talk'?(embedded?<AiWorkspaceEmbed key={accountRevision} view="talk" account={account} onSignIn={onSignIn}/>:<WorkspaceTalk key={accountRevision} api={api} onSignIn={onSignIn}/>):section==='wiki'?<WikiRepository key={accountRevision} api={api} onSignIn={onSignIn}/>:<SkillLibrary key={accountRevision} page api={api} taskId={taskId} openPath={openPath} onRegister={onRegister} marketplaceEnabled connectMarketplace={connectMarketplace} initialTab={initialTab}/>}</div></section>;
}
