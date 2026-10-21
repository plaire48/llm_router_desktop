import '@e2e/cx-design-system/styles.css';
import {OfficeWindowPane} from './OfficeWindowPane.jsx';
import {connectPdfBuffer} from './pdf-editor-client.js';
import {connectBuffer} from './live-editor-client.js';
import {gitCloneErrors} from '../ui/git-clone-error.mjs';
import {hasWikiDrafts} from '../ui/wiki-drafts.mjs';
import {WikiRepository} from '../ui/WikiRepository.jsx';
import {teamWorkspaceMark} from '../ui/TeamWorkspaceMark.js';
import {MailSourcePane} from '../ui/MailSourcePane.jsx';
import React,{useState,useMemo,useRef,useEffect,useLayoutEffect,Suspense,lazy} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {ProjectSwitchCover} from '../ui/ProjectSwitchCover.jsx';
import {WorkspaceToast,notifyWorkspaceToast} from '../ui/WorkspaceToast.jsx';
import {Workbench} from '../ui/Workbench.jsx';
import {useSidebarResize} from '../ui/useSidebarResize.js';
import {useModalDismissalPolicy} from '../ui/useModalDismissalPolicy.js';
import {useModalMotion} from '../ui/modalMotion.js';
import {useNativeTitlebar} from './useNativeTitlebar.js';
import {useWorkspacePageLinks} from '../ui/useWorkspacePageLinks.js';
import {WORKSPACE_LAYOUT,workspaceSlots} from './workspace-layout.cjs';
import {teamWorkspaceErrors} from '../ui/teamWorkspaceErrors.js';
import {GitEmptyState} from '../ui/GitEmptyState.jsx';
import {GitHistory} from './GitHistory.jsx';
import {FileKindIcon} from './FileExplorer.jsx';
import {FileWorkspace} from './FileWorkspace.jsx';
import {BrowserPane} from './BrowserPane.jsx';
import {BrowserDockIntake} from './BrowserWindowDock.jsx';
import {MailProgress} from '../ui/MailProgress.jsx';
import {MailMatchText} from '../ui/MailMatchText.jsx';
import {StartupConnections} from '../ui/StartupConnections.jsx';
import {CxConfirmation} from '@e2e/cx-design-system';
import {ToolsMenu} from './ToolsMenu.jsx';
import {FolderMark,BrowserMark,BranchMark,TerminalMark} from '../ui/marks.jsx';
import {CxButton, CxInput, CxTextarea, Icon} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from '../ui/WorkspaceAction.jsx';

import './workbench.css';
import '../design/workspace-identity.css';
import './shell.css';
import './ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
import '../design/workspace-icons.css';
import './modal-motion.css';
import './workspace-tabs.css';
import '../design/workspace-pastel.css';
import '../design/workspace-alignment.css';
import {animatedSetter,cancelViewTransition} from '../ui/viewTransition.js';
import {CinematicIntro} from '../ui/CinematicIntro.jsx';
import {FirstRunTour} from '../ui/FirstRunTour.jsx';
const DocumentPreview=lazy(()=>import('../ui/DocumentPreview.jsx').then(m=>({default:m.DocumentPreview})));
const Editor=lazy(()=>import('./editor.jsx')),GitDiff=lazy(()=>import('./editor.jsx').then(module=>({default:module.GitDiff})));
const TerminalPanel=lazy(()=>import('./TerminalPanel.jsx'));
const showError=message=>notifyWorkspaceToast(message,{error:true});
let inflight=0,busyTimer=null;
const markBusy=()=>{if(++inflight===1&&!busyTimer)busyTimer=setTimeout(()=>{busyTimer=null;if(inflight>0)document.documentElement.setAttribute('data-host-busy','true');},1500);};
const clearBusy=()=>{if(--inflight<=0){inflight=0;if(busyTimer){clearTimeout(busyTimer);busyTimer=null;}document.documentElement.removeAttribute('data-host-busy');}};
const request=async(method,args)=>{markBusy();try{const result=await window.nubi.request(method,args);if(result?.__nubiError)throw Object.assign(Error(result.__nubiError),{...(result.cloneFailure?{cloneFailure:result.cloneFailure}:{}),...(result.approvalFailure?{approvalFailure:result.approvalFailure}:{})});return result;}finally{clearBusy();}};
const absolutePath=value=>/^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/])/.test(value||'');
const projectRelative=(root,value)=>{if(!root)return null;const canonical=text=>text.replaceAll('\\','/').replace(/\/$/,'');const base=canonical(root),file=canonical(value),windows=/^[A-Za-z]:/.test(base),a=windows?base.toLowerCase():base,b=windows?file.toLowerCase():file;return a===b?'':b.startsWith(a+'/')?file.slice(base.length+1):null;};
const digest=async text=>'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
function App(){
 const [officeDockState,setOfficeDockState]=useState(null);
 useModalDismissalPolicy();
 useModalMotion();
 useNativeTitlebar(request);
 useWorkspacePageLinks(url=>request('openWorkspacePage',{url}),()=>showError('페이지를 열지 못했어요. 다시 시도해 주세요.'));
 const [teamWorkspace,setTeamWorkspace]=useState(null);
 const [teamSection,setTeamSection]=useState('workspace');
 const [projects,setProjects]=useState([]),catalogRevision=useRef(0);
 const projectViews=useRef(new Map()),switching=useRef(false);
 const [cloneProgress,setCloneProgress]=useState(null),cloneRequest=useRef(null);
 const [projectTransition,setProjectTransition]=useState(null),projectRequest=useRef(null);
 useEffect(()=>window.nubi.onHostEvent?.(event=>{if(event.type==='project_open_progress'&&event.requestId===projectRequest.current&&projectRequest.current)setProjectTransition(previous=>previous?{...previous,stage:event.stage}:previous);}),[]);
 useEffect(()=>window.nubi.onHostEvent?.(event=>{if(event.type==='git_clone_progress'&&event.requestId===cloneRequest.current&&cloneRequest.current)setCloneProgress(previous=>({...event,startedAt:previous?.startedAt||Date.now()}));}),[]);
 const [introDone,setIntroDone]=useState(false),[startupReady,setStartupReady]=useState(false),[startupOpen,setStartupOpen]=useState(false),[startupRequest,setStartupRequest]=useState(null),[wikiPrompt,setWikiPrompt]=useState(null);
 const [paneExpanded,setPaneExpandedRaw]=useState(false);
 const shellNode=useRef(null),paneToggle=useRef(null),expandedRef=useRef(false);expandedRef.current=paneExpanded;
 const [toolbarHost,setToolbarHost]=useState(null);
 const [mailSourceReferences,setMailSourceReferences]=useState([]);
 const [changesLoad,setChangesLoad]=useState('idle'),[changesRepository,setChangesRepository]=useState(null),changesRequest=useRef(0);
 const [generation,setGeneration]=useState(0),[project,setProject]=useState(null),[pane,setPaneRaw]=useState(null),[buffer,setBuffer]=useState(null),[diff,setDiff]=useState(null),[revision,setRevision]=useState(0),[rows,setRows]=useState([]),[patch,setPatch]=useState(null),[filter,setFilter]=useState(''),[wiki,setWiki]=useState(null),[shellProfile,setShellProfile]=useState(''),[mailDocument,setMailDocument]=useState(null),[mailQuestion,setMailQuestion]=useState('핵심 내용을 정리해 줘.'),[mailBusy,setMailBusy]=useState(false),[mailSaving,setMailSaving]=useState(false),[mailDraftRequest,setMailDraftRequest]=useState(null);
 const setPane=useMemo(()=>animatedSetter(setPaneRaw),[]),setPaneExpanded=useMemo(()=>animatedSetter(setPaneExpandedRaw),[]);
 const [fileTabs,setFileTabs]=useState([]),[directory,setDirectory]=useState(''),[terminalTabs,setTerminalTabs]=useState([]),[activeTerminal,setActiveTerminal]=useState(null),[toolsOpen,setToolsOpen]=useState(false),[browserMounted,setBrowserMounted]=useState(false);
 const terminalStatus=useRef(new Map()),terminalTabsRef=useRef([]),fileTabsRef=useRef([]),activeTerminalRef=useRef(null),directoryRef=useRef('');terminalTabsRef.current=terminalTabs;fileTabsRef.current=fileTabs;activeTerminalRef.current=activeTerminal;directoryRef.current=directory;
 const [browserCatalog,setBrowserCatalog]=useState({tabs:[],active:null});const browserController=useRef(null);
 const syncBrowser=useMemo(()=>value=>setBrowserCatalog(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value),[]);
 useEffect(()=>window.nubi.onHostEvent?.(event=>{if(event.type==='office_dock_changed'){setOfficeDockState(event.status);if(event.status.phase==='preparing')setPane('office');}}),[]);
 useEffect(()=>window.nubi.onHostEvent?.(event=>{if((event.type==='external_browser_opened'||event.type==='browser_dock_hover'&&event.entered)){setBrowserMounted(true);setPane('browser');if(event.state)syncBrowser(event.state);}}),[syncBrowser]);
 // The host restarts its worker when it dies (electron-app/lifecycle.cjs); the user hears it here.
 useEffect(()=>window.nubi.onHostEvent?.(event=>{if(event.type==='worker_restarting')notifyWorkspaceToast('누비 실행기가 멈춰 다시 시작해요.');else if(event.type==='worker_restarted')notifyWorkspaceToast('누비 실행기를 다시 시작했어요. 보내던 요청은 다시 보내 주세요.');else if(event.type==='worker_failed')showError('누비 실행기를 다시 시작하지 못했어요. 앱을 다시 실행해 주세요.');else if(event.type==='mail_data_reset'){setMailDocument(null);setMailDraftRequest(null);setPane(current=>current==='document'?null:current);window.dispatchEvent(new Event('nubi-mail-reset'));}else if(event.type==='mail_portal_connected'){if(!event.requiresStorageSetup)notifyWorkspaceToast('사내 포털에 연결됐어요. 메일을 가져오기 시작해요.',{success:true});}else if(event.type==='mail_portal_failed')notifyWorkspaceToast(({mail_portal_login:'포털 로그인이 끝나지 않았어요. 메일 설정에서 다시 연결해 주세요.',mail_portal_timeout:'포털 응답이 늦어 연결하지 못했어요.',mail_portal_identity:'포털에서 내 계정을 확인하지 못했어요.'})[event.error]||'사내 포털에 연결하지 못했어요. 메일 설정에서 다시 시도해 주세요.',{error:true});}),[]);
 useEffect(()=>window.nubi.onBrowserEvent?.(event=>{if(event.type==='opened'){syncBrowser(event.state);setBrowserMounted(true);setPane('browser');}else if(['changed','closed'].includes(event.type)){syncBrowser(event.state);if(event.returnToApp)setPane(current=>current==='browser'?null:current);}else if(event.type==='error')showError(event.error==='browser_capture_unavailable'?'페이지를 캡처하지 못했어요. 화면이 표시된 뒤 다시 시도해 주세요.':event.error==='browser_tab_limit'?'브라우저 탭은 12개까지 열 수 있어요.':'이 주소를 열지 못했어요. http 또는 https 주소를 확인해 주세요.');}),[syncBrowser]);
 useEffect(()=>{shellNode.current?.querySelector('.desktop-file-tabs [aria-selected="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'});},[pane,buffer?.key,browserCatalog.active,activeTerminal]);
 const [shellWidth,setShellWidth]=useState(window.innerWidth);
 const [leftPaneWidth,setLeftPaneWidth]=useState(WORKSPACE_LAYOUT.projects);
 const [minimumAgentWidth,setMinimumAgentWidth]=useState(WORKSPACE_LAYOUT.minimumAgent);
 const slots=workspaceSlots(shellWidth,{minimumAgent:minimumAgentWidth,projects:leftPaneWidth});
 const reservedLeft=slots.projects;
 const paneResizable=!!pane&&!paneExpanded&&pane!=='team-workspace';
 const paneResize=useSidebarResize(shellNode,{
  hostWidth:shellWidth,railWidth:WORKSPACE_LAYOUT.rail,enabled:paneResizable,side:'right',
  defaultWidth:slots.defaultAuxiliary,minWidth:['preparing','attaching','docked'].includes(browserCatalog.dock?.phase)?560:WORKSPACE_LAYOUT.minimumAuxiliary,maxWidth:1200,reservedWidth:slots.split?reservedLeft+minimumAgentWidth:0,
  storageKey:'nubi-workspace-auxiliary-width',selector:'.desktop-pane',property:'--desktop-pane-width',
  resizingAttribute:'data-pane-resizing',label:'파일 및 Git 사이드바 너비 조절'
 });
 useLayoutEffect(()=>{
  const workspaceBody=shellNode.current?.querySelector('.desktop-workspace-body');if(!workspaceBody)return;
  const update=()=>setShellWidth(workspaceBody.clientWidth);
  update();const observer=new ResizeObserver(update);observer.observe(workspaceBody);
  return()=>observer.disconnect();
 },[]);
 useLayoutEffect(()=>{
  const workbench=shellNode.current?.querySelector('.nubi-workbench');if(!workbench)return;
  let observed;const sizes=new ResizeObserver(()=>update());
  const update=()=>{const sidebar=workbench.querySelector('.nubi-sidebar');if(sidebar!==observed){sizes.disconnect();observed=sidebar;if(sidebar)sizes.observe(sidebar);}setLeftPaneWidth(sidebar?.dataset.open==='true'&&workbench.dataset.compact!=='true'?sidebar.getBoundingClientRect().width:0);};
  update();const changes=new MutationObserver(update);changes.observe(workbench,{childList:true,subtree:true,attributes:true,attributeFilter:['data-open','data-compact','data-workspace-screen']});
  return()=>{sizes.disconnect();changes.disconnect();};
 },[generation,project?.projectId]);
 const providerSnapshot=useRef(null);
 const projectRef=useRef(project);projectRef.current=project;
 const openRequest=useRef(0);const [fileLoading,setFileLoading]=useState(false);
 const [fileReveal,setFileReveal]=useState(null);
 const buffers=useRef(new Map()),editor=useRef(null),alive=useRef(true),root=useRef(null),apiRef=useRef(null),bufferRef=useRef(null),paneRef=useRef(null);bufferRef.current=buffer;paneRef.current=pane;
 function refreshProjects(){const revision=++catalogRevision.current;return request('projectCatalog').then(value=>{if(revision===catalogRevision.current)setProjects(value);return value;});}
 const api=useMemo(()=>async(method,args)=>{const wikiProject=projectRef.current?.projectId;const catalogRequest=method==='projectCatalog'?++catalogRevision.current:null;const browseRelative=method==='browseDirectory'&&absolutePath(args?.path)?projectRelative(projectRef.current?.root,args.path):undefined;const localBrowse=browseRelative===null;const result=await request(localBrowse?'browseLocalDirectory':method,browseRelative!==undefined&&!localBrowse?{...args,path:browseRelative}:args);if(['overview','openCurrent'].includes(method)&&wikiProject!==projectRef.current?.projectId&&result?.projectId!==projectRef.current?.projectId)throw Error('project_changed');if(catalogRequest===catalogRevision.current&&Array.isArray(result))setProjects(result);if(method==='provider')providerSnapshot.current=result;if(method==='setShellPreference'){setShellProfile('');if(projectRef.current?.projectId===wikiProject){projectRef.current={...projectRef.current,defaultShell:result.profile};setProject(projectRef.current);}}if(['overview','openCurrent','startConversation','chooseFolder','importProject','cloneRepository','switchProject'].includes(method)&&result?.projectId){if(root.current&&root.current!==result.root){projectViews.current.set(root.current,{buffer:bufferRef.current,fileTabs:fileTabsRef.current,directory:directoryRef.current,terminalTabs:terminalTabsRef.current,activeTerminal:activeTerminalRef.current});const saved=projectViews.current.get(result.root);openRequest.current++;setFileLoading(false);setBuffer(saved?.buffer||null);setPane(saved?.buffer?'file':null);setFileTabs(saved?.fileTabs||[]);setDirectory(saved?.directory||'');setFileReveal(null);setTerminalTabs(saved?.terminalTabs||[]);setActiveTerminal(saved?.activeTerminal||null);setMailDocument(null);setMailSourceReferences([]);setMailDraftRequest(null);terminalStatus.current.clear();}root.current=result.root;projectRef.current=result;setProject(result);if(result.projectCatalogWarning)showError('프로젝트는 열었지만 목록을 저장하지 못했어요. 저장 위치의 권한을 확인해 주세요.');void refreshProjects().catch(()=>{});if(Object.hasOwn(result,'wikiInitialization'))setWiki(result.wikiInitialization);else if(result.kind==='conversation')setWiki(null);}if(method==='wikiInitialization'&&alive.current&&projectRef.current?.projectId===wikiProject)setWiki(previous=>JSON.stringify(previous)===JSON.stringify(result)?previous:result);return result;},[]);apiRef.current=api;
 // The host says when the mail prompt applies: automatic summaries on and no account connected (user decision 2026-10-05).
 // No mail prompt or login form opens by itself at startup (user decision 2026-10-15: it collided with the AI sign-in).
 // Mail login stays behind the mail settings and the 포털 로그인 button; startup only marks the window ready.
 useEffect(()=>{let cancelled=false;void api('startupConnections').catch(()=>{}).finally(()=>{if(!cancelled)setStartupReady(true);});return()=>{cancelled=true;};},[api]);
 // A folder opened with an OpenWiki already in it (user request 2026-10-14): keep it as it is, or drop it and build it
 // again. The host finds existing pages right after the open; a project whose Wiki is being built is left alone.
 async function promptExistingWiki(){
  for(let attempt=0;attempt<20;attempt++){
   let state;try{state=await api('wikiInitialization',{action:'status'});}catch{return;}
   if(state?.state==='existing'){setWikiPrompt({pages:state.pages??0});return;}
   if(state?.state!=='running'||state.stage!=='scanning')return;
   await new Promise(resolve=>setTimeout(resolve,300));
  }
 }
 async function changeProject(method,args){
  if(switching.current||[...terminalStatus.current.values()].some(Boolean))throw Error('project_busy');
  if(hasWikiDrafts()||[...buffers.current.values()].some(b=>b.dirty))throw Error('editor_dirty');
  const progressId=crypto.randomUUID();projectRequest.current=progressId;args={...args,progressId};
  const selected=projects.find(item=>item.id===args.id);
  flushSync(()=>setProjectTransition({startedAt:Date.now(),name:selected?.name||selected?.displayName||(method==='startConversation'?'개인 공간':'프로젝트 열기'),stage:method==='chooseFolder'?'selecting':method==='importProject'?'selecting_zip':'resolving'}));
  switching.current=true;document.documentElement.setAttribute('data-project-switching','true');
  const body=shellNode.current?.querySelector('.desktop-workspace-body');if(body)body.inert=true;
  cancelViewTransition();
  try{
   if(method==='cloneRepository'){cloneRequest.current=progressId;setCloneProgress({stage:'destination',percent:null,startedAt:Date.now()});}
   const result=await api(method,args);
   // Commit the new project and its fresh Workbench before uncovering the UI.
   // A queued view-transition snapshot must never replay the previous project.
   if(result?.projectId)flushSync(()=>{setProjectTransition(previous=>previous?{...previous,stage:'rendering'}:previous);setGeneration(n=>n+1);});
   return result;
  }finally{projectRequest.current=null;setProjectTransition(null);cloneRequest.current=null;setCloneProgress(null);switching.current=false;if(body)body.inert=false;document.documentElement.removeAttribute('data-project-switching');}
 }
 useEffect(()=>window.nubi.onHostEvent?.(event=>{
  if(event.type==='wiki_open'){void openWikiNotice(event,{currentProjectId:()=>projectRef.current?.projectId,switchProject:id=>changeProject('switchProject',{id}),present:setStartupRequest}).catch(error=>showError(error.message==='editor_dirty'?'수정 중인 파일을 저장한 뒤 위키를 열어 주세요.':'프로젝트 위키를 열지 못했어요. 프로젝트 목록에서 다시 열어 주세요.'));return;}
  if(event.type!=='answer_open')return;
  void openAnswerNotice(event,{currentProjectId:()=>projectRef.current?.projectId,
   switchProject:(id,kind)=>kind==='conversation'?changeProject('startConversation'):changeProject('switchProject',{id}),readTask:taskId=>api('conversationHistory',{taskId}),
   present:setStartupRequest}).catch(error=>showError(error.message==='editor_dirty'?'수정 중인 파일을 저장한 뒤 대화를 열어 주세요.':error.message==='project_busy'?'현재 작업을 정리한 뒤 해당 대화를 열어 주세요.':'대화를 열지 못했어요. 대화 목록을 확인해 주세요.'));
 }),[]);
 async function obtainLocal(absolute){const projectId=projectRef.current?.projectId,file=await api('readLocalFile',{projectId,path:absolute});if(projectRef.current?.projectId!==projectId)throw Error('project_changed');const key='local:'+file.uri;let item=buffers.current.get(key);if(item){if(item.model&&item.hash!==file.hash)item.model.setValue(file.content);Object.assign(item,{hash:file.hash,preview:file.preview,document:file.document});return item;}const {monaco,languageForPath}=(file.preview||file.document)?{}:await import('./editor.jsx');if(projectRef.current?.projectId!==projectId)throw Error('project_changed');item={...file,key,dirty:false,...(file.preview||file.document)?{}:{model:monaco.editor.createModel(file.content,languageForPath(file.path),monaco.Uri.parse('nubi-local:'+encodeURIComponent(file.uri)))}};buffers.current.set(key,item);return item;}
 async function obtain(rel,taskId,outputId){const projectId=projectRef.current?.projectId;if(outputId||/\.(png|jpe?g|gif|webp|ico|pdf|docx|docm|dotx|dotm|pptx|pptm|ppsx|ppsm|potx|potm|xlsx|xlsm|xltx|xltm)$/i.test(rel)){const value=await api('previewFile',{projectId,path:rel,taskId,...(outputId?{outputId}:{})});if(projectRef.current?.projectId!==projectId)throw Error('project_changed');const key=`preview:${projectId}:${outputId?taskId+':'+outputId:rel}`,existing=buffers.current.get(key);if(existing&&existing.hash===value.hash&&existing.taskId===taskId&&existing.root===value.root)return existing;if(existing?.dirty)throw Error('editor_dirty');const item={key,path:rel,taskId,root:value.root,preview:value.content,document:value.document,readOnly:true,hash:value.hash,dirty:false};buffers.current.set(key,item);return item;}const file=await api('editorSource',{projectId,path:rel,taskId}),key=file.uri;if(projectRef.current?.projectId!==projectId)throw Error('project_changed');let item=buffers.current.get(key);if(item){item.root=file.root;item.taskId=taskId;if(!item.dirty&&item.hash!==file.hash){item.hash=file.hash;item.saved=file.content;item.model.setValue(file.content);item.dirty=false;}return item;}
   const {monaco,languageForPath}=await import('./editor.jsx');const language=languageForPath(rel);if(projectRef.current?.projectId!==projectId)throw Error('project_changed');if(buffers.current.has(key))return buffers.current.get(key);
   item={key,path:rel,taskId,root:file.root,hash:file.hash,saved:file.content,dirty:false,model:monaco.editor.createModel(file.content,language,monaco.Uri.parse(key))};item.model.onDidChangeContent(()=>{item.dirty=item.model.getValue()!==item.saved;if(item.dirty){setFileTabs(current=>current.includes(key)?current:[...current,key]);if(bufferRef.current?.key===key&&paneRef.current==='files')setPane('file');}setRevision(n=>n+1);});buffers.current.set(key,item);return item;
 }
 function activateBuffer(item,{preview=false}={}){for(const [key,candidate] of buffers.current){if(key!==item.key&&candidate.root===item.root&&!candidate.dirty&&!fileTabsRef.current.includes(key)){candidate.model?.dispose();buffers.current.delete(key);}}setBuffer(item);const pinned=fileTabsRef.current.includes(item.key);if(!preview||pinned||item.dirty)setFileTabs(current=>current.includes(item.key)?current:[...current,item.key]);setDiff(null);setPane(preview&&!pinned&&!item.dirty?'files':'file');}
 async function openPath(rel,taskId,options){
  if(options?.projectId&&options.projectId!==projectRef.current?.projectId)throw Error('project_changed');
  const request=++openRequest.current;setFileLoading(true);
  try{
   const relative=absolutePath(rel)?projectRelative(projectRef.current?.root,rel):rel;const item=await (relative===null?obtainLocal(rel):obtain(relative,taskId,options?.outputId));
   if(options?.expectedHash&&item.hash!==options.expectedHash)throw Error('answer_source_changed');
   if(options?.expectedHash&&item.dirty)throw Error('editor_dirty');
   if(!alive.current||request!==openRequest.current||options?.canPresent&&!options.canPresent())return null;
   // Revealing a source range chooses the editor; clearing its highlight after typing must not switch to preview.
   item.sourceSelection=options?.line?{line:options.line,endLine:options.endLine,id:crypto.randomUUID()}:null;if(options?.source||options?.line)item.editSource=true;
   activateBuffer(item,options);
   if(options?.revealInExplorer){const base=directoryRef.current;if(base&&!rel.startsWith(base+'/'))setDirectory('');setFileReveal({id:crypto.randomUUID(),path:rel,key:item.key});}
   setRevision(value=>value+1);return item;
  }finally{if(alive.current&&request===openRequest.current)setFileLoading(false);}
 }
 function closeFile(key){const item=buffers.current.get(key);if(!item)return;if(item.dirty&&!window.confirm('저장하지 않은 수정이 있어요. 이 파일 탭을 닫을까요?'))return;const remaining=fileTabsRef.current.filter(tab=>tab!==key);if(bufferRef.current===item){const next=buffers.current.get(remaining.at(-1));setBuffer(next||null);if(paneRef.current==='file')setPane(next?'file':'files');}setFileTabs(remaining);buffers.current.delete(key);item.model?.dispose();}
 function openTerminal(profileId,context={}){
  if(typeof window.nubi.terminal!=='function'){showError('대화형 터미널은 누비 앱에서 열어 주세요.');return;}
  const current=projectRef.current;if(!current)return;
  const profile=current.profiles.find(item=>item.id===(profileId||current.defaultShell));
  if(!profile){showError('설정에서 사용할 셸을 확인해 주세요.');return;}
  const cwd=typeof context.cwd==='string'?context.cwd:absolutePath(directoryRef.current)?'':directoryRef.current;
  const processTab=context.processId&&terminalTabsRef.current.find(tab=>tab.processId===context.processId);
  if(processTab){setActiveTerminal(processTab.id);setPane('terminal');return;}
  const existing=!context.processId&&context.contextId&&terminalTabsRef.current.find(tab=>tab.contextId===context.contextId&&tab.profileId===profile.id&&tab.cwd===cwd&&terminalStatus.current.get(tab.id)!==false);
  if(existing){setActiveTerminal(existing.id);setPane('terminal');return;}
  if(terminalTabsRef.current.length>=12){showError('터미널 탭은 12개까지 열 수 있어요.');return;}
  const id=crypto.randomUUID(),item={id,profileId:profile.id,label:profile.label,cwd,contextId:context.contextId,processId:context.processId};
  terminalTabsRef.current=[...terminalTabsRef.current,item];setTerminalTabs(terminalTabsRef.current);setActiveTerminal(id);setPane('terminal');
 }

 async function closeTerminal(id){const projectId=projectRef.current?.projectId;if(!id||!projectId)return;const tab=terminalTabsRef.current.find(item=>item.id===id);const result=tab?.processId?{}:await window.nubi.terminal({action:'close',id,projectId});if(result?.__nubiError&&result.__nubiError!=='terminal_session_missing'){showError('터미널을 닫지 못했어요. 다시 시도해 주세요.');return;}const remaining=terminalTabsRef.current.filter(tab=>tab.id!==id);setTerminalTabs(remaining);terminalStatus.current.delete(id);if(activeTerminalRef.current===id){setActiveTerminal(remaining.at(-1)?.id||null);if(paneRef.current==='terminal'&&!remaining.length)setPane('files');}}
 async function createEditorDraft(args){
  const owner=projectRef.current?.projectId,registration=await api('liveEditor',{action:'draft',projectId:owner,...args});
  try{const {monaco}=await import('./editor.jsx');if(owner!==projectRef.current?.projectId)throw Error('project_changed');
   const key=registration.binding.documentId,item={key,path:registration.title,root:root.current,draft:true,source:registration.draft.source,saved:'',dirty:true,model:monaco.editor.createModel(registration.draft.text,'plaintext',monaco.Uri.parse(key))};
   item.model.onDidChangeContent(()=>{item.dirty=item.model.getValue()!==item.saved;setRevision(v=>v+1);});buffers.current.set(key,item);activateBuffer(item);setRevision(v=>v+1);
   return await connectBuffer({api,projectId:owner,buffer:item,getEditor:()=>editor.current,isCurrent:()=>projectRef.current?.projectId===owner,registration});
  }catch(error){await api('liveEditor',{action:'disconnect',projectId:owner,token:registration.token}).catch(()=>{});throw error;}
 }
 async function save(item=bufferRef.current,proposalId){if(!item?.model||item.readOnly)return;const version=item.model.getVersionId(),content=item.model.getValue();if(item.draft){const bytes=new TextEncoder().encode(content);let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));const result=await api('saveDocumentCopy',{kind:'txt',filename:item.path,data:btoa(binary)});if(result.saved){item.saved=content;item.dirty=item.model.getVersionId()!==version||item.model.getValue()!==content;setRevision(v=>v+1);}return result;}const result=await api('saveSource',{path:item.path,taskId:item.taskId,expectedHash:item.hash,content,...(proposalId?{proposalId}:{})});item.hash=result.hash;item.saved=content;item.dirty=item.model.getVersionId()!==version||item.model.getValue()!==content;setRevision(n=>n+1);}
 async function reviewApplied(row,taskId,{canPresent=()=>true}={}){const projectId=projectRef.current?.projectId;const value=await api('appliedFileSummary',{taskId,path:row.path,expectedHash:row.hash,_projectId:projectId});if(projectRef.current?.projectId!==projectId||!canPresent())return;setDiff({...value,applied:true});setPane('diff');}
 async function review(id){const proposal=await api('proposalArtifacts',{proposalId:id});const before=await api('proposalText',{proposalId:id});setDiff({before:before.before,after:before.after});setPane('diff');}
 async function apply(id){const proposal=await api('prepareProposal',{proposalId:id});if(proposal.alreadyApplied)return proposal;if(proposal.kind==='create'){if([...buffers.current.values()].some(b=>b.key===proposal.uri&&b.dirty))throw Error('editor_dirty');return api('applyNewFile',{proposalId:id});}
   const item=await obtain(proposal.path,proposal.taskId);if(item.dirty)throw Error('editor_dirty');const version=item.model.getVersionId(),actual=await digest(item.model.getValue());if(item.dirty||item.model.getVersionId()!==version||actual!==proposal.expectedHash)throw Error('source_stale');
   item.model.pushStackElement();item.model.pushEditOperations([],[{range:item.model.getFullModelRange(),text:proposal.content}],()=>null);item.model.pushStackElement();await save(item,id);activateBuffer(item);return api('confirmProposal',{proposalId:id});
 }
 async function loadChanges(){const id=++changesRequest.current;setChangesLoad('loading');setRows([]);try{const result=await api('workspaceChanges');if(id===changesRequest.current){setRows(result.entries);setChangesRepository(result.repositoryState);setChangesLoad('ready');}}catch(error){if(id!==changesRequest.current)return;setChangesLoad('error');throw error;}}
 async function view(name){changesRequest.current++;if(name===null){setPane(null);return;}if(name==='terminal'){openTerminal();return;}/* Git's selected rail button closes changes, history or diff immediately. File navigation still returns to the tree. Read-only loading must not hold Workbench's action lock. */if(paneRef.current===name||name==='changes'&&['history','diff'].includes(paneRef.current)){setPane(null);return;}setFilter('');setPatch(null);setRows([]);setPane(name);if(name==='changes')void act(loadChanges);}
 async function openMailDocument(id,attachmentId,reference={}){const value=await api('mailDocument',{id,attachmentId,location:reference.location,expectedSourceHash:reference.sourceHash,expectedAttachmentHash:reference.attachmentHash});const location=reference.location,segment=location?value.segments?.find(item=>location.page&&item.page===location.page||location.slide&&item.slide===location.slide||location.sheet&&item.sheet===location.sheet):null;if(location&&!segment)throw Error('mail_source_changed');if(reference.canPresent&&!reference.canPresent())return;setMailDocument({...value,id,attachmentId,sourceHash:value.sourceHash||reference.sourceHash,attachmentHash:value.attachmentHash||reference.attachmentHash,searchQuery:reference.query||'',...(segment?{citationLocation:location,citationText:segment.text}:{})});setPane('document');}
 function askMailDocument(){setMailDraftRequest({requestId:crypto.randomUUID(),reference:{id:mailDocument.id,sourceHash:mailDocument.sourceHash,attachmentId:mailDocument.attachmentId,attachmentHash:mailDocument.attachmentHash,...mailDocument.citationLocation?{location:mailDocument.citationLocation}:{}}});}
 async function downloadMailDocument(){
  if(mailSaving)return;setMailSaving(true);
  try{const value=await api('downloadMail',{id:mailDocument.id,attachmentId:mailDocument.attachmentId,expectedSourceHash:mailDocument.sourceHash,expectedAttachmentHash:mailDocument.attachmentHash,kind:'attachment'});if(value.saved)notifyWorkspaceToast('파일을 저장했어요.');else if(value.previewOnly)notifyWorkspaceToast('화면 미리보기예요. 실제 파일은 저장하지 않았어요.');}
  catch{showError('파일을 저장하지 못했어요. 메일 원문을 다시 확인해 주세요.');}finally{setMailSaving(false);}
 }
 async function openTeamWorkspace(options={}){
  if(paneRef.current==='team-workspace'&&!options.refresh){setPane(null);return {hidden:true};}
  const account=await api('ghesAccount',{operation:'status'});if(!account.connected)return {loginRequired:true};
  setTeamWorkspace(previous=>previous||{loading:true});setPane('team-workspace');
  try{
   const value=await api('openTeamWorkspace',options);if(value.loginRequired){setTeamWorkspace(null);return value;}
   const url=new URL(value.url);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!/^\/w\/[a-f0-9]{64}\/index\.html$/.test(url.pathname))throw Error('team_workspace_scope');
   setTeamWorkspace(value);return value;
  }catch(error){setTeamWorkspace(previous=>previous?.url?previous:{unavailable:true});throw error;}
 }
 useEffect(()=>{void api('projectCatalog').catch(()=>showError('프로젝트 목록을 불러오지 못했어요.'));},[]);
 const ports=useMemo(()=>({createEditorDraft,connectEditor:async()=>{const owner=projectRef.current?.projectId;if(bufferRef.current?.pdfEndpoint)return connectPdfBuffer({api,projectId:owner,buffer:bufferRef.current,isCurrent:()=>projectRef.current?.projectId===owner});return connectBuffer({api,projectId:owner,buffer:bufferRef.current,getEditor:()=>editor.current,isCurrent:()=>projectRef.current?.projectId===owner});},focusDecision:async decision=>{await changeProject('switchProject',{id:decision.projectId});setStartupRequest({target:'decision',decision});},api:(method,args)=>api(method,{...args,...(project?.projectId?{_projectId:project.projectId}:{})}),installUpdate:async()=>{if(hasWikiDrafts()||[...buffers.current.values()].some(b=>b.dirty))throw Error('editor_dirty');if([...terminalStatus.current.values()].some(Boolean))throw Error('update_work_active');return api('workspaceUpdate',{action:'install'});},switchProject:id=>changeProject('switchProject',{id}),renameProject:(id,name)=>api('projectCatalog',{action:'rename',id,name}),removeProject:async id=>{if(id===projectRef.current?.projectId)await changeProject('startConversation');return api('projectCatalog',{action:'remove',id});},openMailDocument,openMailSources:references=>{setMailSourceReferences(references);setPane('mail-source');},closeMailDocument:()=>setPane(current=>current==='document'?null:current),openCurrent:()=>api('openCurrent'),startConversation:()=>changeProject('startConversation'),chooseFolder:async()=>{const result=await changeProject('chooseFolder');if(result?.projectId)void promptExistingWiki();return result;},importProject:()=>changeProject('importProject'),cloneRepository:url=>changeProject('cloneRepository',{url}),workspaceView:view,openTerminal:context=>openTerminal(undefined,context),openPath,openOutput:(card,taskId)=>card.captureId?openPath(card.name,taskId,{outputId:card.id}):openPath(card.path,taskId),review,reviewApplied,apply,openURI:async uri=>{const result=await api('artifactText',{uri});setDiff({before:'',after:result.content});setPane('diff');},openBrowser:url=>api('openBrowser',{url}),openWebPage:url=>api('openWorkspacePage',{url}),ghesAccount:async operation=>{const value=await api('ghesAccount',{operation});if(!value.connected){setTeamWorkspace(null);setPane(current=>current==='team-workspace'?null:current);}return value;},connectMarketplace:()=>api('connectMarketplace'),openTeamWorkspace,ghesRepositories:async()=>{const choices=await api('ghesRepositories');setRows(choices);setPane('repositories');return {cancelled:true};}}),[project?.projectId]);
 async function act(operation){try{return await operation();}catch(e){showError(teamWorkspaceErrors[e.message]||gitCloneErrors[e.message]||({project_changed:'프로젝트가 바뀌었어요. 현재 대화에서 출처를 다시 열어 주세요.',editor_dirty:'저장하지 않은 파일을 먼저 확인해 주세요.',source_stale:'파일이 바뀌었어요. 현재 내용과 다시 비교해 주세요.',mail_attachment_beta_disabled:'Beta에서는 첨부 다운로드만 지원해요.',document_format:'이 문서 형식은 아직 읽을 수 없어요.',binary_file:'이 파일은 코드 편집기로 열 수 없어요.',file_encoding:'UTF-8 텍스트 파일을 열어 주세요.',file_too_large:'이 파일은 미리보기 한도보다 커요.',path_scope:'이 경로는 열 수 없어요. 일반 파일이나 폴더를 선택해 주세요.'})[e.message]||`작업을 확인해 주세요. (${e.message})`);}}
 useEffect(()=>{const key=event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector('[role="dialog"], [role="alertdialog"]')){if(expandedRef.current)setPaneExpanded(false);else setPane(null);return;}if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='w'&&paneRef.current==='terminal'){event.preventDefault();closeTerminal(activeTerminalRef.current);return;}if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='w'&&paneRef.current==='file'&&bufferRef.current){event.preventDefault();const item=bufferRef.current;if(item.dirty){showError('저장하지 않은 수정이 있어요. 먼저 파일을 저장해 주세요.');return;}buffers.current.delete(item.key);item.model?.dispose();setFileTabs(current=>current.filter(key=>key!==item.key));setBuffer(null);setPane('files');return;}if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void act(()=>save());}if((event.metaKey||event.ctrlKey)&&event.shiftKey&&event.key.toLowerCase()==='p'){event.preventDefault();setPane('commands');}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 useEffect(()=>{if(!pane)setPaneExpanded(false);},[pane]);
 useLayoutEffect(()=>{
  if(!paneExpanded||!pane)return;
  const shell=shellNode.current,content=shell?.querySelector('.nubi-workbench-content');
  if(!shell||!content)return;
  // Overlay the agent area without shrinking/remounting its sidebar, draft or run.
  const update=()=>{const bounds=shell.getBoundingClientRect(),sidebar=shell.querySelector('.nubi-sidebar'),left=Math.max(0,content.getBoundingClientRect().left-bounds.left,sidebar?sidebar.getBoundingClientRect().right-bounds.left:0);shell.style.setProperty('--desktop-expanded-left',`${left}px`);};
  if(content.contains(document.activeElement))paneToggle.current?.focus();
  const previousInert=content.inert;content.inert=true;update();
  const observer=new ResizeObserver(update);observer.observe(shell);observer.observe(content);
  const sidebar=shell.querySelector('.nubi-sidebar');if(sidebar)observer.observe(sidebar);
  const changes=new MutationObserver(update);if(sidebar)changes.observe(sidebar,{attributes:true,attributeFilter:['data-open']});
  return()=>{observer.disconnect();changes.disconnect();content.inert=previousInert;shell.style.removeProperty('--desktop-expanded-left');};
 },[paneExpanded,!!pane,generation]);
 useEffect(()=>{if(!project)return;let busy=false;const refresh=async()=>{if(busy)return;busy=true;try{const status=await api('wikiInitialization');if(!alive.current||projectRef.current?.projectId!==project.projectId)return;setWiki(previous=>JSON.stringify(previous)===JSON.stringify(status)?previous:status);if(status?.state==='completed'&&wiki?.state!=='completed')await api('overview');}catch{}finally{busy=false;}};void refresh();/* A finished or idle setup changes only through an action that refreshes it, so it is checked rarely (2026-10-14: background work). */const timer=setInterval(refresh,wiki?.state==='running'?500:['completed','existing','cancelled','attention'].includes(wiki?.state)?15000:1200);return()=>clearInterval(timer);},[project?.projectId,wiki?.state]);

 useEffect(()=>()=>{alive.current=false;for(const b of buffers.current.values())b.model?.dispose();},[]);
 const fileDock=['files','file','browser','terminal'].includes(pane);
 const pageTabs=browserCatalog.tabs;
 async function newWebTab(){setBrowserMounted(true);setPane('browser');syncBrowser(await api('browser',{action:'new'}));}
 const [dockOrder,setDockOrder]=useState([]),dockStrip=useRef(null);
 const dockKeys=[...fileTabs.map(key=>'file:'+key),...terminalTabs.map(tab=>'terminal:'+tab.id),...pageTabs.map(tab=>'web:'+tab.id)];
 const dockKey=dockKeys.join('\n');
 useEffect(()=>{setDockOrder(previous=>{const next=[...previous.filter(key=>dockKeys.includes(key)),...dockKeys.filter(key=>!previous.includes(key))];return next.join('\n')===previous.join('\n')?previous:next;});},[dockKey]);
 const orderedDockKeys=[...dockOrder.filter(key=>dockKeys.includes(key)),...dockKeys.filter(key=>!dockOrder.includes(key))];
 useLayoutEffect(()=>{
  const strip=dockStrip.current,active=strip?.querySelector('[aria-selected="true"]');if(!strip||!active)return;
  const item=active.closest('.desktop-workspace-tab')||active;
  const reveal=()=>{const bounds=strip.getBoundingClientRect(),rect=item.getBoundingClientRect();if(rect.right>bounds.right)strip.scrollLeft+=rect.right-bounds.right;else if(rect.left<bounds.left)strip.scrollLeft-=bounds.left-rect.left;};
  reveal();const observer=new ResizeObserver(reveal);observer.observe(strip);observer.observe(item);return()=>observer.disconnect();
 },[pane,buffer?.key,activeTerminal,browserCatalog.active,dockKey,pageTabs.map(tab=>tab.title).join('\n')]);
 function dockTab(key){
  if(key.startsWith('file:')){const item=buffers.current.get(key.slice(5));if(!item)return null;return {key,label:item.path.split(/[\\/]/).at(-1),title:item.absolute||item.path,icon:<FileKindIcon name={item.path}/>,selected:pane==='file'&&buffer?.key===item.key,dirty:item.dirty,closeLabel:`${item.path.split(/[\\/]/).at(-1)} 파일 탭 닫기`,select:()=>activateBuffer(item),close:()=>closeFile(item.key)};}
  if(key.startsWith('terminal:')){const tab=terminalTabs.find(tab=>tab.id===key.slice(9));if(!tab)return null;const index=terminalTabs.indexOf(tab)+1;return {key,label:tab.label+(terminalTabs.length>1?' '+index:''),title:tab.label,icon:<TerminalMark size={15}/>,selected:pane==='terminal'&&activeTerminal===tab.id,closeLabel:`${tab.label} ${index} 터미널 탭 닫기`,select:()=>{setActiveTerminal(tab.id);setPane('terminal');},close:()=>closeTerminal(tab.id)};}
  const tab=pageTabs.find(tab=>tab.id===key.slice(4));if(!tab)return null;const label=tab.url==='about:blank'?'새 웹 탭':tab.title||'웹 페이지';return {key,label,title:tab.url,icon:<BrowserMark size={15}/>,loading:tab.loading,selected:pane==='browser'&&browserCatalog.active===tab.id,closeLabel:`${label} 웹 탭 닫기`,select:()=>{setPane('browser');void browserController.current?.action('select',{id:tab.id});},close:()=>void browserController.current?.action('close',{id:tab.id})};
 }
 const title=({office:'Office',files:'파일',file:buffer?.path,changes:'Git 변경',history:'커밋 이력',search:'검색',terminal:'터미널',diff:diff?.applied?diff.path+(diff.partial?' (최근 반영)':' 변경 비교'):'변경 비교',commands:'도구',repositories:'회사 저장소',document:mailDocument?.mailMessage?'첨부 메일':mailDocument?.title||'첨부 문서','mail-source':'메일 원문','team-workspace':'AI Workspace'})[pane];

 return <div ref={shellNode} className="desktop-shell" inert={!introDone} data-startup-ready={startupReady} data-toolbar="true" data-platform={window.nubi?.platform} data-layout={slots.split?'split':'overlay'}><BrowserDockIntake api={api}/><div className="desktop-titlebar" ref={setToolbarHost}/><CinematicIntro ready={startupReady} onFinish={()=>setIntroDone(true)}/><FirstRunTour active={introDone&&startupReady}/><ProjectSwitchCover progress={cloneProgress} transition={projectTransition}/><div className="desktop-workspace-body"><div className="desktop-agent" onFocusCapture={event=>{if(!slots.split&&pane&&!paneExpanded&&event.target.matches?.('.aipro-message-input')&&!document.querySelector('[role=dialog]'))setPane(null);}}><Workbench initialProject={project} initialProvider={providerSnapshot.current} projects={projects} key={generation} hostLayout="integrated" toolbarHost={toolbarHost} onMinimumAgentWidth={setMinimumAgentWidth} toastHost={false} {...ports} startupRequest={startupRequest} onStartupHandled={()=>setStartupRequest(null)} mailDraftRequest={mailDraftRequest} onMailDraftHandled={()=>setMailDraftRequest(null)} wikiInitialization={wiki} activeView={pane} activeFile={buffer?.path}/></div>
 {(pane||teamWorkspace||project||browserMounted)&&<aside id="nubi-auxiliary-pane" className="desktop-pane" data-expanded={paneExpanded||undefined} data-team-workspace={pane==='team-workspace'||undefined} hidden={!pane} aria-label="보조 작업 영역"><header className={fileDock?'desktop-dock-header':undefined}>

 {fileDock?<div ref={dockStrip} className="desktop-file-tabs" onKeyDown={event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;const tabs=[...event.currentTarget.querySelectorAll('[role="tab"]')],index=tabs.indexOf(document.activeElement);if(index<0)return;event.preventDefault();const next=tabs[(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];next.focus();next.click();}} role="tablist" aria-label="파일, 브라우저, 터미널"><CxButton role="tab" aria-label="파일 탐색기" title="파일 탐색기" aria-selected={pane==='files'} onClick={()=>setPane('files')}><FolderMark size={18}/><span>파일</span></CxButton>{orderedDockKeys.map(key=>{const tab=dockTab(key);return tab&&<span className="desktop-workspace-tab" key={key}><CxButton className="desktop-tab-select" role="tab" aria-selected={tab.selected} title={tab.title} onClick={tab.select} onKeyDown={event=>{if(event.key==='Delete'){event.preventDefault();tab.close();}}} onAuxClick={event=>{if(event.button===1){event.preventDefault();tab.close();}}}>{tab.icon}<span>{tab.label}</span>{tab.dirty&&<span className="desktop-dirty" aria-label="저장하지 않은 변경">●</span>}{tab.loading&&<span className="status-spinner" aria-label="페이지 불러오는 중"/>}</CxButton><CxButton className="desktop-tab-close" aria-label={tab.closeLabel} title="탭 닫기" onClick={event=>{event.stopPropagation();tab.close();}}><Icon name="xClose" size={12}/></CxButton></span>;})}</div>:['changes','history'].includes(pane)?<span className="desktop-git-heading" aria-label={title} title={title}><BranchMark size={18}/>{pane==='history'&&<span>{title}</span>}</span>:pane==='team-workspace'?<span className="desktop-team-heading" role="img" aria-label={title} title={title}><img src={teamWorkspaceMark} alt=""/></span>:<strong>{title}</strong>}
 {pane==='team-workspace'&&<ActionButton action="refresh" iconOnly label="AI Workspace 새로고침" title="GHES의 최신 화면 불러오기" onClick={()=>{if(window.confirm('화면을 다시 불러올까요? 저장하지 않은 편집 내용은 사라집니다.'))void act(()=>openTeamWorkspace({refresh:true}));}}/>}
 {fileDock&&<ToolsMenu profiles={project?.profiles} defaultShell={project?.defaultShell} projectReady={!!project} onOpenChange={setToolsOpen} onTerminal={openTerminal} onFiles={()=>setPane('files')} onWeb={()=>void act(newWebTab)}/>}
 <div className="desktop-pane-controls"><CxButton ref={paneToggle} className="desktop-pane-expand desktop-pane-left-control" aria-label={paneExpanded?'3분할로 돌아가기':'보조 영역 넓게 보기'} title={paneExpanded?'3분할로 돌아가기':'보조 영역 넓게 보기'} aria-pressed={paneExpanded} aria-controls="nubi-auxiliary-pane" onClick={()=>setPaneExpanded(value=>!value)}><Icon name={paneExpanded?'panelLeftClose':'panelLeft'} size={18}/></CxButton>
 {!paneExpanded&&<CxButton className="desktop-pane-expand desktop-pane-right-control" aria-label="오른쪽 사이드바 닫기" title="오른쪽 사이드바 닫기" aria-controls="nubi-auxiliary-pane" onClick={()=>setPane(null)}><Icon name="panelLeftClose" size={18}/></CxButton>}</div></header>
 {paneResizable&&<div className="desktop-pane-resize" title="드래그해 너비 조절. 더블클릭해 기본 너비로 복원" aria-controls="nubi-auxiliary-pane" {...paneResize}/>}
 {teamWorkspace&&<div className="desktop-team-workspace" hidden={pane!=='team-workspace'}><nav className="nubi-team-sections" role="tablist" aria-label="AI Workspace 영역"><CxButton role="tab" aria-selected={teamSection==='workspace'} onClick={()=>setTeamSection('workspace')}><Icon name="layoutGrid02" size={16}/>Workspace</CxButton><CxButton role="tab" aria-selected={teamSection==='wiki'} onClick={()=>setTeamSection('wiki')}><Icon name="bookmark" size={16}/>위키</CxButton></nav>{teamSection==='wiki'&&<WikiRepository api={api}/>}{teamWorkspace.url&&<iframe hidden={teamSection!=='workspace'} key={teamWorkspace.url} title="AI Workspace" src={teamWorkspace.url} sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads" referrerPolicy="no-referrer"/>}{!teamWorkspace.url&&teamSection==='workspace'&&<p className="nubi-team-loading" role="status">{teamWorkspace.loading?'Workspace를 불러오는 중':'Workspace 화면을 불러오지 못했어요. 위키 메뉴에서 공유 저장소를 열 수 있어요.'}</p>}<div hidden={!teamWorkspace.url||teamSection!=='workspace'} className="desktop-team-workspace-source" title={`GHES 화면 버전 ${teamWorkspace.revision||''}`}><FolderMark size={13}/><span>{teamWorkspace.repository}</span><code>{teamWorkspace.revision?.slice(0,7)}</code></div></div>}
 {project&&<FileWorkspace onDocumentDirty={(file,dirty)=>{file.dirty=dirty;setRevision(v=>v+1);}} key={project.projectId} api={api} project={project} buffer={buffer} revealRequest={fileReveal?.key===buffer?.key?fileReveal:null} loading={fileLoading} cwd={directory} visible={['files','file'].includes(pane)} pinned={pane==='file'} onDirectory={setDirectory} onOpen={rel=>act(()=>openPath(rel,bufferRef.current?.taskId))} onSave={()=>void act(()=>save())} onReady={instance=>{editor.current=instance;}} onError={error=>showError(({path_scope:'이 경로는 열 수 없어요. 일반 파일이나 폴더를 선택해 주세요.',directory_missing:'폴더 경로를 확인해 주세요.',binary_file:'이 파일은 코드 편집기로 열 수 없어요.',file_too_large:'1 MB 이하의 텍스트 파일을 열어 주세요.',file_encoding:'UTF-8 텍스트 파일을 열어 주세요.',source_missing:'파일이 없어요. 삭제되었거나 옮겨졌는지 확인해 주세요.',project_changed:'프로젝트가 바뀌어 이 파일을 열 수 없어요. 다시 열어 주세요.'})[error.message]||`파일을 읽지 못했어요. 경로를 확인해 주세요.${/^[a-z_]+$/.test(error.message||'')?` (${error.message})`:''}`)}/>}
 {pane==='diff'&&<Suspense fallback={<p>편집기 준비 중</p>}>{diff?.applied?<GitDiff diff={diff}/>:<Editor diff={diff} onReady={instance=>{editor.current=instance;}}/>}</Suspense>}
 {officeDockState&&<OfficeWindowPane api={api} status={officeDockState} visible={pane==='office'} onError={()=>showError('Office 화면을 가져오지 못했어요. 외부 Office에서 문서를 확인해 주세요.')}/>}
 {browserMounted&&<BrowserPane api={api} projectId={project?.projectId} controller={browserController} onState={syncBrowser} visible={pane==='browser'} obscured={toolsOpen} onError={error=>showError(({browser_url_invalid:'http 또는 https 주소를 입력해 주세요.',browser_tab_limit:'브라우저 탭은 12개까지 열 수 있어요.',browser_desktop_only:'Electron 앱에서 브라우저를 열어 주세요.'})[error.message]||'브라우저 작업을 완료하지 못했어요.')}/>}
 {project&&terminalTabs.map(tab=><Suspense key={tab.id} fallback={pane==='terminal'&&activeTerminal===tab.id?<p>터미널 준비 중</p>:null}><TerminalPanel sessionId={tab.id} processId={tab.processId} onInteractive={()=>openTerminal(undefined,{cwd:tab.cwd,contextId:`input:${tab.processId}`})} api={api} project={project} profileId={tab.profileId} cwd={tab.cwd} onDirectory={cwd=>setTerminalTabs(tabs=>tabs.map(item=>item.id===tab.id?{...item,cwd}:item))} onBusy={busy=>terminalStatus.current.set(tab.id,busy)} visible={pane==='terminal'&&activeTerminal===tab.id} onError={error=>showError(({path_scope:'프로젝트 안에서 명령을 실행해 주세요.',project_busy:'진행 중인 작업이 끝난 뒤 실행해 주세요.',shell_unavailable:'설정에서 사용할 셸을 확인해 주세요.',command_invalid:'명령어를 확인해 주세요.',terminal_request_limit:'실행 기록이 가득 찼어요. 실행이 끝난 뒤 앱을 다시 열어 주세요.'})[error.message]||'명령을 실행하지 못했어요. 경로와 셸 설정을 확인해 주세요.')}/></Suspense>)}
 {pane==='search'&&<form onSubmit={e=>{e.preventDefault();if(pane==='search')act(async()=>setRows((await api('search',{query:filter})).results));}}><CxInput aria-label={pane==='files'?'파일 이름 검색':'내용 검색'} value={filter} onChange={e=>setFilter(e.target.value)} placeholder={pane==='files'?'파일 찾기':'내용 검색'}/>{pane==='search'&&<CxButton type="submit"><Icon name="search" size={16}/>검색</CxButton>}</form>}
 {pane==='search'&&<div className="desktop-list">{rows.map((row,i)=><CxButton key={i} onClick={()=>act(()=>openPath(row.path))}><Icon name="file" size={16}/>{row.path}:{row.line}<small>{row.excerpt}</small></CxButton>)}</div>}
 {pane==='changes'&&<div className="desktop-list desktop-change-list"><CxButton onClick={()=>act(()=>view('history'))}><Icon name="gitCommit" size={16}/>커밋 이력 보기</CxButton>{rows.map(row=><CxButton key={row.path} onClick={()=>act(async()=>{setPatch(await api('workspaceChanges',{path:row.path}));})}><Icon name="file" size={18}/><span className="desktop-change-path" title={row.path}>{row.path}</span><small>{({modified:'수정',added:'추가',deleted:'삭제',untracked:'새 파일'})[row.state]||row.state}</small></CxButton>)}{changesLoad==='loading'&&<div className="desktop-git-loading" role="status"><span className="status-spinner" aria-hidden="true"/><span>변경 내용 불러오는 중</span></div>}{changesLoad==='error'&&<CxButton onClick={()=>act(loadChanges)}><Icon name="refresh" size={16}/>다시 불러오기</CxButton>}{changesLoad==='ready'&&!rows.length&&<GitEmptyState title={changesRepository==='not_git_repository'?'Git 이력이 없는 폴더예요':undefined}/>}{patch&&(patch.after!==undefined?/* the working change reads like the commit history: an inline Monaco diff of HEAD and the file (2026-10-07) */<section className="desktop-git-file desktop-change-diff"><div className="desktop-git-file-heading"><Icon name="file" size={18}/><strong title={patch.path}>{patch.path}</strong><small>{({modified:'수정',added:'추가',deleted:'삭제'})[patch.state]||patch.state}{patch.patchTruncated?' (일부만 표시)':''}</small></div><div className="desktop-git-file-content"><Suspense fallback={<div className="desktop-git-loading" role="status"><span className="status-spinner" aria-hidden="true"/><span>변경 비교 준비 중</span></div>}><GitDiff diff={{path:patch.path,before:patch.before,after:patch.after}}/></Suspense></div></section>:<pre>{patch.patch||(patch.state==='untracked'?'새 파일은 파일을 열어 내용을 확인하세요.':patch.patchUnavailable==='file_size_limit'?'파일이 커서 변경 내용을 표시하지 않아요.':'현재 변경이 없어요.')}</pre>)}</div>}
 {pane==='history'&&<GitHistory key={project?.projectId} projectId={project?.projectId} api={api} onError={e=>showError(({git_history_changed:'새 커밋이 있어요. 새로고침하면 최신 이력부터 볼 수 있어요.',git_branch_missing:'브랜치가 바뀌었어요. 커밋 이력을 새로고침해 주세요.',path_scope:'이 파일은 변경 비교에서 열 수 없어요.'})[e.message]||'커밋 이력을 불러오지 못했어요. 다시 확인해 주세요.')}/>}
 {pane==='mail-source'&&mailSourceReferences.length>0&&<MailSourcePane references={mailSourceReferences} api={api} onDocument={openMailDocument} onAsk={reference=>setMailDraftRequest({requestId:crypto.randomUUID(),reference})}/>}
 {pane==='document'&&mailDocument&&<section className={mailDocument.mailMessage?"desktop-mail-source":"desktop-list"}>{!mailDocument.mailMessage&&<div className="nubi-mail-document-toolbar"><p className="desktop-hint">{mailDocument.coverage}</p>{<CxButton type="button" className="nubi-mail-ask" disabled={!!mailDraftRequest} onClick={askMailDocument}><Icon name="message" size={16}/><span>대화에서 질문</span></CxButton>}<ActionButton action="download" label="첨부 원본 다운로드" busy={mailSaving} onClick={downloadMailDocument}/></div>}{mailDocument.image?<img className="nubi-mail-image-preview" src={mailDocument.image} alt={mailDocument.title}/>:<>{mailDocument.citationText&&<section className="desktop-cited-excerpt" aria-label="인용한 첨부 위치"><strong>{mailDocument.citationLocation.page?`${mailDocument.citationLocation.page}쪽`:mailDocument.citationLocation.slide?`슬라이드 ${mailDocument.citationLocation.slide}`:mailDocument.citationLocation.sheet}</strong><pre><MailMatchText text={mailDocument.citationText} query={mailDocument.searchQuery}/></pre></section>}<Suspense fallback={<span className="status-spinner" aria-label="문서 여는 중"/>}><DocumentPreview key={`${mailDocument.id}:${mailDocument.attachmentId}`} document={mailDocument} mailActions={{onAsk:askMailDocument,askDisabled:!!mailDraftRequest,onDownloadOriginal:downloadMailDocument,downloadBusy:mailSaving}} onDownloadAttachment={part=>api('downloadMail',{id:mailDocument.id,kind:'attachment',attachmentId:mailDocument.attachmentId,expectedSourceHash:mailDocument.sourceHash,expectedAttachmentHash:mailDocument.attachmentHash,innerAttachmentId:part.id,expectedInnerHash:part.sha256})} onRange={async offset=>{const observed=mailDocument;try{const value=await api('mailDocument',{id:observed.id,attachmentId:observed.attachmentId,offset,expectedSourceHash:observed.sourceHash,expectedAttachmentHash:observed.attachmentHash});setMailDocument(current=>current?.id===observed.id&&current?.attachmentId===observed.attachmentId?{...current,...value}:current);}catch{showError('문서를 읽지 못했어요. 다시 시도해 주세요.');}}}/></Suspense>{!mailDocument.mailMessage&&<form onSubmit={e=>{e.preventDefault();setMailBusy(true);act(async()=>{const observed=mailDocument;const value=await api('mailDocument',{id:observed.id,attachmentId:observed.attachmentId,expectedSourceHash:observed.sourceHash,expectedAttachmentHash:observed.attachmentHash,action:'ask',offset:observed.offset||0,question:mailQuestion});setMailDocument(current=>current?.id===observed.id&&current?.attachmentId===observed.attachmentId&&current?.sourceHash===observed.sourceHash?({...current,...value}):current);}).finally(()=>setMailBusy(false));}}><CxTextarea aria-label="첨부 문서 질문" value={mailQuestion} onChange={e=>setMailQuestion(e.target.value)}/><CxButton type="submit" disabled={mailBusy||!mailQuestion.trim()}><Icon name="message" size={16}/>{mailBusy?'응답 대기':'현재 모델에 질문'}</CxButton></form>}{!mailDocument.mailMessage&&mailDocument.answer&&<section><small>{mailDocument.model}</small><pre>{mailDocument.answer}</pre></section>}</>}</section>}
 {pane==='commands'&&<div className="desktop-list">{[['files','파일'],['changes','Git 변경'],['history','커밋 이력'],['search','검색'],['terminal','터미널']].map(([name,label])=><CxButton key={name} onClick={()=>act(()=>view(name))}>{name==='terminal'?<TerminalMark size={16}/>:<Icon name={({files:'file',changes:'gitCommit',history:'clock',search:'search'})[name]} size={16}/>}{label}</CxButton>)}</div>}
 {pane==='repositories'&&<div className="desktop-list">{rows.map(row=><CxButton key={row.id} onClick={()=>act(()=>changeProject('cloneRepository',{repositoryId:row.id}))}><FolderMark size={16}/>{row.label}<small>{row.description}</small></CxButton>)}</div>}

 </aside>}</div><MailProgress api={api} wiki={wiki} onSettings={()=>setStartupRequest({target:'mail',id:crypto.randomUUID()})} onOpenMessage={source=>setStartupRequest({target:'mail-source',source,id:crypto.randomUUID()})}/>{wikiPrompt&&<CxConfirmation className="nubi-wiki-existing" icon="bookmark" title="OpenWiki가 이미 있어요" message={`이 폴더에 OpenWiki 문서 ${wikiPrompt.pages}개가 있어요. 그대로 가져올까요? 지우면 처음부터 다시 만들어요.`} cancelLabel="그대로 가져오기" confirmLabel="지우고 다시 만들기" busy={!!wikiPrompt.busy} onCancel={()=>setWikiPrompt(null)} onConfirm={async()=>{setWikiPrompt(current=>({...current,busy:true}));try{await api('wikiInitialization',{action:'reset',confirmed:true});setGeneration(n=>n+1);notifyWorkspaceToast('기존 OpenWiki를 지우고 다시 만들기 시작했어요.',{success:true});}catch(error){notifyWorkspaceToast(error?.message==='wiki_busy'?'위키 작업이 진행 중이라 지금은 지울 수 없어요.':'OpenWiki를 지우지 못했어요.');}finally{setWikiPrompt(null);}}}/>}{startupOpen&&<StartupConnections onClose={()=>setStartupOpen(false)} onConnect={target=>{setStartupOpen(false);setStartupRequest({target,id:crypto.randomUUID()});}}/>}<WorkspaceToast/></div>;
}
// A rendering error must not leave an empty window: the shell shows what failed and offers to open the screen again
// (the project, conversations and mail live in the worker, so nothing is lost by reloading).
class ShellErrorBoundary extends React.Component{
 constructor(props){super(props);this.state={error:null};}
 static getDerivedStateFromError(error){return {error};}
 componentDidCatch(error,info){const root=document.getElementById('root');if(root)root.inert=false;delete document.body.dataset.nubiOpening;document.getElementById('nubi-boot-cover')?.remove();console.error('renderer_crash',error,info?.componentStack);}
 render(){
  if(!this.state.error)return this.props.children;
  const message=String(this.state.error?.message||this.state.error).slice(0,200);
  return <div className="desktop-crash" role="alert"><h1>화면을 그리지 못했어요</h1><p>프로젝트와 대화, 메일은 실행기에 그대로 있어요. 화면만 다시 열면 돼요.</p><p className="desktop-crash-detail">오류: <code>{message}</code></p><button type="button" className="desktop-crash-reload" onClick={()=>location.reload()}>화면 다시 열기</button></div>;
 }
}
document.body.classList.add('nubi-desktop-host');
createRoot(document.getElementById('root')).render(<ShellErrorBoundary><App/></ShellErrorBoundary>);
import {openWikiNotice} from '../ui/open-wiki-notice.mjs';
import {openAnswerNotice} from '../ui/open-answer-notice.mjs';
