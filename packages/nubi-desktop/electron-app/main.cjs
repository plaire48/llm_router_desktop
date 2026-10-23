const {OfficeWindowDock}=require('./office-window-dock.cjs');
let officeDock;
const {safeApprovalFailure}=require('./approval-failure.cjs');
const {trustedRenderer}=require('./renderer-scope.cjs');
const {app,BrowserWindow,protocol,net,ipcMain,dialog,clipboard,Menu,Notification,session,powerMonitor}=require('electron');
const {watchWikiLifecycle}=require('./wiki-lifecycle.cjs');
const {prepareNativeInput}=require('./native-input-preparation.cjs');
const {watchMotionVisibility}=require('./motion-visibility.cjs');
const {WindowExpansion}=require('./window-expansion.cjs');
const {fork,spawn}=require('node:child_process');
const {WorkspaceUpdater}=require('./workspace-updater.cjs');
const {readFile,writeFile,mkdir,realpath,rm}=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {ElectronHost}=require('./native-host.cjs');
const {safeCloneFailure}=require('./git-clone-error.cjs');
const {ghesImageTarget,fetchGhesImage}=require('./ghes-image.cjs');
const {browseLocalDirectory,readLocalFile}=require('./local-file-view.cjs');
const {startWebHost}=require('./web-host.cjs');
const {installationStamp}=require('./installation-stamp.cjs');
const {captureWindow}=require('./window-capture.cjs');
const {PlaywrightHost}=require('./playwright-host.cjs');
const {ExternalBrowserHost}=require('./external-browser-host.cjs');
const {createExternalBrowserContentPort}=require('./external-browser-content-port.cjs');
const {ChromeDirectConnection}=require('./chrome-direct-connection.cjs');
const {samsungInstallation,samsungPortFile}=require('./samsung-browser-discovery.cjs');
let browserContentPort;
const {BrowserLaunch}=require('./external-browser-launch.cjs');
const {BrowserRouter}=require('./browser-router.cjs');
const {BrowserWindowNative}=require('./browser-window-native.cjs');
const {BrowserWindowDock}=require('./browser-window-dock.cjs');
const {ExternalMailPortal}=require('./external-mail-portal.cjs');
const {BrowserHost}=require('./browser-host.cjs');
const {mailSourceStatus}=require('./mail-source-status.cjs');
const {ClaudeWeb}=require('./claude-web.cjs');
const {TerminalHost}=require('./terminal-host.cjs');
const {shellProfiles}=require('../runtime/processes.mjs');
const {DEFAULT_TITLEBAR}=require('./titlebar-colors.cjs');
const {openingCaptionOptions,OpeningCaption}=require('./opening-caption.cjs');
const {importProjectZip}=require('../runtime/project-zip.mjs');
const {configureSystemTrust,disableHostedTracing}=require('../runtime/worker-environment.mjs');
const {DESKTOP_FEATURES}=require('../runtime/beta-features.mjs');
const {workspacePageUrl}=require('../runtime/workspace-browser.mjs');
const {restoreSavedProject,createProjectRestorer}=require('./project-restore.cjs');
const {WorkerSupervisor,restoreWindowState,windowStateOf,boundedLog,startupMailPrompt}=require('./lifecycle.cjs');
configureSystemTrust();disableHostedTracing(process.env);
require('./bundled-git.cjs').configureBundledGit({packaged:app.isPackaged,resourcesPath:process.resourcesPath});
app.setName('누비 Workspace');if(process.platform==='win32')app.setAppUserModelId('nubi.workspace');
// One running Workspace (2026-10-05): a second start, a double-click on the shortcut, brings the first window forward
// instead of opening a second window and a second worker on the same project state (project_locked).
// A storage root of its own (checks, evaluation runs) is its own instance and its own Chromium profile: it never competes
// with the running Workspace for the lock, which is keyed on userData (2026-10-07). The product start has no root and is unchanged.
if(process.env.NUBI_STORAGE_ROOT)app.setPath('userData',path.join(process.env.NUBI_STORAGE_ROOT,'app'));
const primary=app.requestSingleInstanceLock();
if(!primary)app.quit();
app.on('second-instance',()=>{if(!window||window.isDestroyed())return;if(window.isMinimized())window.restore();window.show();window.focus();});
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}},{scheme:'nubi-ghes',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let terminalHost,updater,installingUpdate=false;
const wikiGitControllers=new Map();
const cancelWikiGit=()=>{for(const controller of wikiGitControllers.values())controller.abort();wikiGitControllers.clear();};
app.on('before-quit',cancelWikiGit);
let playwrightHost,browserRouter,externalBrowser,browserLaunch,browserDock;
const browserDockControllers=new Map();
let window,worker,host,webHost,browserHost,mailPortal,claudeWeb,currentRoot=null,currentKind='project';const launchId=randomUUID();
let claudeCliUsage=null,workspaceFetch=null;const {createClaudeCliUsage}=require('./claude-cli-usage.cjs');
const storage=process.env.NUBI_STORAGE_ROOT||path.join(app.getPath('userData'),'workspace');
const {ProjectCatalog}=require('./project-catalog.cjs');
const projectCatalog=new ProjectCatalog(storage);
const {WikiLibrary}=require('./wiki-library.cjs');
let resettingData=false;
const wikiLibrary=new WikiLibrary({backupRoot:path.join(storage,'wiki-revisions'),search:(scope,query)=>invoke('wikiQuery',{query,view:'pages',projectId:scope.id}),roots:async()=>{
 const projects=await projectCatalog.list(),mail=await invoke('mail',{action:'status'});
 return [...projects.map(p=>({id:p.id,name:p.name,kind:'project',root:path.join(p.root,'openwiki')})),{id:'personal-mail',name:'메일',kind:'mail',root:mail.wikiRoot}];
},canWrite:async scope=>{if(resettingData)return false;if(scope.kind==='mail'){const state=await invoke('mail',{action:'status'});return !state.summarizing&&!state.resetPending;}return !(await invoke('projectActivity',{projectId:scope.id})).active;}});
let openingProject=false;
function recordFault(component,details={}){
 const reason=['clean-exit','abnormal-exit','killed','crashed','oom','launch-failed','integrity-failure'].includes(details.reason)?details.reason:'unexpected';
 const record={at:new Date().toISOString(),component,reason,...(Number.isInteger(details.exitCode)?{exitCode:details.exitCode}:{})};
 void mkdir(storage,{recursive:true}).then(()=>writeFile(path.join(storage,'last-host-fault.json'),JSON.stringify(record),{mode:0o600})).catch(()=>{});
}
process.on('uncaughtExceptionMonitor',()=>recordFault('main'));
async function portalMailStatus(snapshot,{includeMessages=true}={}){return mailSourceStatus({snapshot,invoke,portal:mailPortal,includeMessages});}
function invoke(method,args={}){if(!worker)return Promise.reject(Error('host_disconnected'));return worker.invoke(method,args);}
// What the window needs to hear from the host itself (the worker restarted, or gave up): nubi:host-event.
function hostEvent(event){if(window&&!window.isDestroyed()&&!window.webContents.isDestroyed())window.webContents.send('nubi:host-event',event);}
// The window where the user left it: its bounds are saved as it moves and restored on the displays present next time.
const windowStateFile=path.join(storage,'window-state.json');let windowStateTimer=null;
async function loadWindowState(){try{return JSON.parse(await readFile(windowStateFile,'utf8'));}catch{return null;}}
function saveWindowState(){
 if(!window||window.isDestroyed())return;clearTimeout(windowStateTimer);
 windowStateTimer=setTimeout(()=>{void mkdir(storage,{recursive:true}).then(()=>writeFile(windowStateFile,JSON.stringify(windowStateOf(window)),{mode:0o600})).catch(()=>{});},500);
}
function trusted(event){trustedRenderer(event,window);}
async function choose(properties,title,filters){const result=await dialog.showOpenDialog(window,{properties,title,filters});return result.canceled?null:result.filePaths[0];}
// Company pages (portal reader and login, company GitHub login) share one persistent session, so one SSO login serves all of them (user decision 2026-10-14).
const COMPANY_PARTITION='persist:nubi-company';
function companySession(){const value=session.fromPartition(COMPANY_PARTITION);if(!value.nubiCompanyReady){value.nubiCompanyReady=true;value.setPermissionRequestHandler((_wc,permission,callback)=>callback(permission==='clipboard-sanitized-write'));value.setPermissionCheckHandler((_wc,permission)=>permission==='clipboard-sanitized-write');}return value;}
// One bounded PNG of Nubi's own window for the agent (user request 2026-10-14: "인앱 내에서라도" screen capture), so a
// question about what the app shows can be answered from the screen. Only this app's window, never the desktop.
async function captureAppWindow(options={}){return browserContentPort?browserContentPort.capture(()=>captureWindow(window,browserHost,options)):captureWindow(window,browserHost,options);}
function openWorkspacePage(url,options={}){if(!browserHost||!window||window.isDestroyed())throw Error('browser_unavailable');if(options.authentication){browserRouter.externalFocus=false;const tab=browserHost.create(workspacePageUrl(url),options);browserHost.publish('opened');return {opened:true,tabId:tab.id,userInteractionRequired:true};}return browserRouter.open(url,options);}
function openPageLink(url){void Promise.resolve().then(()=>openWorkspacePage(url)).catch(error=>{hostEvent({type:'external_browser_open_failed',error:/^[a-z_]+$/.test(error.message)?error.message:'browser_url_invalid'});});}
const {createNotificationHistory}=require('./notification-history.cjs');
const notificationHistory=createNotificationHistory(path.join(storage,'notification-delivery-v1.json'));
const {createDecisionNotices}=require('./decision-notices.cjs');
const {createMailLoginNotices}=require('./mail-login-notices.cjs');
const mailLoginNotices=createMailLoginNotices({history:notificationHistory,Notification,getWindow:()=>window,send:hostEvent,icon:path.join(__dirname,'nubi-icon.png')});
const {createWikiNotices}=require('./wiki-notices.cjs');
const wikiNotices=createWikiNotices({history:notificationHistory,Notification,getWindow:()=>window,send:hostEvent,icon:path.join(__dirname,'nubi-icon.png')});
const {createAnswerNotices}=require('./answer-notices.cjs');
const answerNotices=createAnswerNotices({history:notificationHistory,Notification,getWindow:()=>window,send:hostEvent,icon:path.join(__dirname,'nubi-icon.png')});
const decisionNotices=createDecisionNotices({history:notificationHistory,Notification,getWindow:()=>window,send:hostEvent,icon:path.join(__dirname,'nubi-icon.png')});
app.on('before-quit',()=>{decisionNotices.clear();answerNotices.clear();wikiNotices.clear();mailLoginNotices.clear();});
const {connectionVault,workerKey}=require('./connection-vault.cjs');
const vault=connectionVault({directory:path.join(storage,'connections-v1'),safeStorage:require('electron').safeStorage});
function secretScope(service,key){if(service!=='nubi.workspace.electron'||key!=='nubi.ghes.code.sdsdev.co.kr')throw Error('secret_scope');}
const keyStore={
 async getPassword(service,key){secretScope(service,key);return vault.get(key);},
 async setPassword(service,key,value){secretScope(service,key);return vault.set(key,value);},
 async deletePassword(service,key){secretScope(service,key);return vault.delete(key);}
};
function projectOpenProgress(requestId,stage){if(typeof requestId==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(requestId))hostEvent({type:'project_open_progress',requestId,stage});}
async function openProject(root,kind='project',{initializeWiki=true,exactRoot=false,sourceKind,progressId}={}){
 if(openingProject)throw Error('project_busy');openingProject=true;
 try{
 await officeDock?.detach();
 // A predecessor that is still exiting (quit or crash) holds the project store for a moment; the single-instance lock
 // rules out a live second instance, so a short retry is safe.
 let overview;for(let attempt=0;;attempt++){try{projectOpenProgress(progressId,'opening');overview=await invoke('open',{root,kind,initializeWiki,exactRoot,sourceKind});break;}catch(error){if(error.message!=='project_locked'||attempt>=4)throw error;projectOpenProgress(progressId,'waiting_lock');await new Promise(resolve=>setTimeout(resolve,600));}}currentRoot=overview.root;currentKind=kind;
 projectOpenProgress(progressId,'saving');
 try{await mkdir(storage,{recursive:true});await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root:currentRoot,kind}),{mode:0o600});await projectCatalog.remember(overview);}catch{overview.projectCatalogWarning=true;}
 return overview;
 }finally{openingProject=false;}
}
const forbidden=new Set(['_textEditor','_externalOffice','importDocumentSelection','projectActivity','prepareAppUpdate','open','importSkill','connectSkillMarketplace','disconnectSkillMarketplace','initializeWiki','collaboration']);
const restoreCurrentProject=createProjectRestorer(async()=>{
 if(currentRoot)return await invoke('overview');
 let saved;try{saved=JSON.parse(await readFile(path.join(storage,'last-project.json'),'utf8'));}catch{return null;}
 if(!saved?.root)return null;
 try{return await restoreSavedProject(()=>openProject(saved.root,saved.kind==='conversation'?'conversation':'project',{initializeWiki:false}),{existing:()=>currentRoot?invoke('overview'):undefined,onEvent:async event=>{await mkdir(storage,{recursive:true});await writeFile(path.join(storage,'last-project-restore.json'),JSON.stringify({at:new Date().toISOString(),...event}),{mode:0o600}).catch(()=>{});}});}
 catch(error){if(error.message==='project_path_missing')await rm(path.join(storage,'last-project.json'),{force:true}).catch(()=>{});throw error;}
});
app.whenReady().then(async()=>{
 await notificationHistory.ready;
 if(!primary)return;
 const appIcon=path.join(__dirname,'nubi-icon.png');
 if(process.platform==='darwin')app.dock?.setIcon(appIcon);
 const frontend=await realpath(path.join(__dirname,'frontend'));
 // Company GitHub images for the embedded AI Workspace screens: the renderer has no company session, so the host reads
 // the image with the signed-in token, or the company session's own cookies, and hands back image bytes only.
 // Photos on the avatars host of the same server (subdomain isolation) and redirects between those hosts are followed:
 // the token only on the main host (Node fetch, redirects checked one by one), the company session with its cookies
 // otherwise. Electron's session fetch rejects redirect:'manual', which made every redirected photo fail (2026-10-14).
 protocol.handle('nubi-ghes',async request=>{try{
  const url=new URL(request.url),target=ghesImageTarget(url.searchParams.get('u')||'');
  if(request.method!=='GET'||!target)return new Response('',{status:403});
  const token=host?.account?.state==='connected'&&host.account.record?.token||null;
  const image=await fetchGhesImage(target,{token,apiFetch:token?fetch:null,sessionFetch:(href,options)=>companySession().fetch(href,options),signal:AbortSignal.timeout(15000)});
  return image?new Response(image.bytes,{headers:{'content-type':image.type,'cache-control':'private, max-age=600','x-content-type-options':'nosniff'}}):new Response('',{status:404});
 }catch{return new Response('',{status:400});}});
 protocol.handle('app',async request=>{try{const url=new URL(request.url);if(url.host!=='bundle'||request.method!=='GET'||request.initiatorOrigin&&request.initiatorOrigin!=='app://bundle')return new Response('',{status:403});const target=await realpath(path.resolve(frontend,'.'+decodeURIComponent(url.pathname)));const rel=path.relative(frontend,target);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))return new Response('',{status:403});return net.fetch(pathToFileURL(target).href);}catch{return new Response('',{status:404});}});
 // The service worker, restarted when it dies (lifecycle.cjs): its errors go to a bounded log for a report, never its
 // requests. The window keeps its project: the new worker opens it again before the next request is answered.
 const workerLog=boundedLog({file:path.join(storage,'worker.log')});
 worker=new WorkerSupervisor({spawn:()=>{
  const child=fork(path.join(__dirname,'backend/service-entry.mjs'),[],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NUBI_STORAGE_ROOT:storage},stdio:['ignore','ignore','pipe','ipc']});
  child.stderr.on('data',chunk=>{void workerLog(chunk);});return child;
 },onMessage:message=>{
  if(message?.routineActivity){hostEvent({type:'routine_activity',...message.routineActivity});return;}
  if(message?.wikiCompleted){wikiNotices.show(message.wikiCompleted);return;}
  if(message?.answerCompleted){answerNotices.show(message.answerCompleted);return;}
  if(message?.playwrightCancel){browserDockControllers.get(message.playwrightCancel.id)?.abort();return;}
  if(message?.playwrightRequest){const {id,action,args}=message.playwrightRequest;if(typeof id!=='string'||id.length>80)return;void(async()=>{try{if(!playwrightHost)throw Error('browser_unavailable');const controller=['bring','dockDetach'].includes(action)?new AbortController():null;if(controller)browserDockControllers.set(id,controller);let result;try{result=await playwrightHost.request(action,args,{signal:controller?.signal});}finally{browserDockControllers.delete(id);}worker.send({playwrightReply:{id,result}});}catch(error){worker.send({playwrightReply:{id,error:/^[a-z_]+$/.test(error.message)?error.message:'browser_unavailable'}});}})();return;}
  if(message?.wikiGitCancel){wikiGitControllers.get(message.wikiGitCancel.id)?.abort();return;}
  if(message?.wikiGitRequest){
   const {id,root}=message.wikiGitRequest;if(typeof id!=='string'||id.length>80||typeof root!=='string'||!path.isAbsolute(root)||wikiGitControllers.has(id))return;
   const controller=new AbortController();wikiGitControllers.set(id,controller);
   void(async()=>{try{const result=await host.syncWikiSources(root,{signal:controller.signal});worker.send({wikiGitReply:{id,result}});}catch(error){worker.send({wikiGitReply:{id,error:/^[a-z_]{3,60}$/.test(error.message)?error.message:'git_pull_failed'}});}finally{wikiGitControllers.delete(id);}})();return;
  }
  if(message?.connectionSecretRequest){
    const {id,operation,key,value}=message.connectionSecretRequest;
   if(typeof id!=='string'||id.length>80)return;
   // A worker reaches its provider connections, the mail vault keys and MCP secrets, never company credentials.
   void (async()=>{try{
    if(!workerKey(key)||!['get','set','delete'].includes(operation))throw Error('secret_scope');
    const result=await vault[operation](key,value);worker.send({connectionSecretReply:{id,value:result??null}});
   }catch{worker.send({connectionSecretReply:{id,error:'secret_unavailable'}});}})();return;
  }
  if(message?.workspaceAuthPageClose){const tabId=message.workspaceAuthPageClose.tabId;if(typeof tabId==='string'&&browserHost?.tabs.get(tabId)?.authentication)browserHost.closeTab(tabId,{returnToApp:true});return;}
  if(message?.workspaceCaptureRequest){const {id,target,options={}}=message.workspaceCaptureRequest;if(typeof id!=='string')return;(async()=>{try{if(target==='window'){worker.send({workspaceCaptureReply:{id,...await captureAppWindow(options)}});return;}if(!browserHost)throw Error('browser_unavailable');const result=await browserRouter.capture(options);worker.send({workspaceCaptureReply:{id,...result}});}catch(error){worker.send({workspaceCaptureReply:{id,error:/^[a-z_]+$/.test(error.message)?error.message:'browser_capture_unavailable'}});}})();return;}
  if(!message?.workspacePageRequest)return;const {id,url,authentication}=message.workspacePageRequest;if(typeof id!=='string')return;
  void(async()=>{try{const result=await openWorkspacePage(url,{authentication:authentication===true});worker.send({workspacePageReply:{id,...result}});}
  catch(error){worker.send({workspacePageReply:{id,error:/^[a-z_]+$/.test(error.message)?error.message:'browser_unavailable'}});}})();
 }});
 worker.on('fault',details=>{cancelWikiGit();playwrightHost?.dispose();recordFault('worker',details);});
 worker.on('restarting',details=>hostEvent({type:'worker_restarting',...details}));
 worker.on('failed',details=>hostEvent({type:'worker_failed',...details}));
 worker.on('restarted',async details=>{
  try{if(currentRoot)await invoke('open',{root:currentRoot,kind:currentKind,initializeWiki:false});hostEvent({type:'worker_restarted',...details});}
  catch(error){hostEvent({type:'worker_failed',...details,error:/^[a-z_]+$/.test(error.message)?error.message:'operation_failed'});}
 });
 worker.start();
 const stopWikiLifecycle=watchWikiLifecycle({powerMonitor,net,invoke,owner:()=>currentRoot});app.once('before-quit',stopWikiLifecycle);
 host=new ElectronHost({storage,keyStore,invoke,helperPath:path.join(__dirname,'git-askpass.cjs'),avatarFetcher:(url,options)=>{
  if(!ghesImageTarget(url))throw Error('ghes_avatar_unavailable');
  // Use normal requests in the app's authenticated browser session. No cookie
  // extraction, external browser storage or token forwarding is involved.
  return companySession().fetch(url,options);
 },openBrowser:url=>openWorkspacePage(url,{authentication:true,companyLogin:host.account.device?.uri===url,session:companySession()}),confirmWorkspaceSave:async change=>{
  const result=await dialog.showMessageBox(window,{type:'question',title:'AI Workspace에 저장',message:`${change.repository}에 변경을 저장할까요?`,detail:`브랜치: ${change.branch}\n${change.message}\n\n${change.files.slice(0,24).join('\n')}${change.files.length>24?`\n외 ${change.files.length-24}개 파일`:''}`,buttons:['저장','취소'],defaultId:1,cancelId:1,noLink:true});return result.response===0;
 }});
 const {screen}=require('electron'),windowState=restoreWindowState(await loadWindowState(),screen.getAllDisplays());
 const installId=await installationStamp({packaged:app.isPackaged,platform:process.platform,executable:app.getPath('exe')});
 window=new BrowserWindow({icon:appIcon,width:windowState.width,height:windowState.height,...(windowState.x!==undefined?{x:windowState.x,y:windowState.y}:{}),minWidth:620,minHeight:540,title:`누비 Workspace ${app.getVersion()}`,backgroundColor:'#FFFFFF',titleBarStyle:process.platform==='darwin'?'hiddenInset':'hidden',...(process.platform==='darwin'?{trafficLightPosition:{x:14,y:17}}:{titleBarOverlay:DEFAULT_TITLEBAR}),...openingCaptionOptions(),webPreferences:{additionalArguments:installId?['--nubi-installation='+installId]:[],preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
 const openingCaption=new OpeningCaption(window);
 const restoreOpeningCaption=()=>openingCaption.opening(false);
 app.on('before-quit',restoreOpeningCaption);
 window.once('closed',()=>app.removeListener('before-quit',restoreOpeningCaption));
 watchMotionVisibility(window);
 const windowExpansion=new WindowExpansion(window,screen);
 window.once('closed',()=>windowExpansion.dispose());
 window.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame){decisionNotices.clear();answerNotices.clear();wikiNotices.clear();mailLoginNotices.clear();openingCaption.opening(true);openingCaption.appearance(DEFAULT_TITLEBAR);}});
 window.webContents.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3)openingCaption.opening(false);});
 if(windowState.maximized)window.maximize();
 for(const name of ['resize','move','maximize','unmaximize'])window.on(name,saveWindowState);
 window.on('close',()=>{clearTimeout(windowStateTimer);try{require('node:fs').mkdirSync(storage,{recursive:true});require('node:fs').writeFileSync(windowStateFile,JSON.stringify(windowStateOf(window)),{mode:0o600});}catch{}});
 window.webContents.on('will-navigate',(event,url)=>{if(url==='app://bundle/index.html')return;event.preventDefault();if(/^https?:/i.test(url))openPageLink(url);});/* Copy buttons write the clipboard from a user gesture (clipboard-sanitized-write); denying every permission made each copy fail with '복사 실패' (user report 2026-10-09). Everything else (media, notifications, location, reading the clipboard) stays denied. */window.webContents.session.setPermissionRequestHandler((_wc,permission,callback)=>callback(permission==='clipboard-sanitized-write'));Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'누비 Workspace',submenu:[{label:'새로고침',role:'reload',accelerator:'CmdOrCtrl+R'},{type:'separator'},{role:'quit'}]},{label:'편집',submenu:[{role:'undo'},{role:'redo'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]}]));
 // A window whose renderer died comes back by itself; the worker, the login and the running work are not in it.
 window.webContents.on('render-process-gone',(_event,details)=>{openingCaption.opening(false);recordFault('workspace_renderer',details);terminalHost?.dispose();if(details.reason!=='clean-exit'&&!window.isDestroyed())setTimeout(()=>{if(!window.isDestroyed())window.webContents.reload();},300);});
 let unresponsive=null;
 window.on('unresponsive',async()=>{
  openingCaption.opening(false);
  if(unresponsive)return;unresponsive=new AbortController();
  try{const {response}=await dialog.showMessageBox(window,{type:'warning',message:'누비 Workspace 화면이 응답하지 않아요.',detail:'기다리면 돌아올 수 있어요. 다시 열면 화면만 새로 열고, 로그인과 진행 중인 작업은 그대로예요.',buttons:['기다리기','다시 열기'],defaultId:0,cancelId:0,noLink:true,signal:unresponsive.signal});
   if(response===1&&!window.isDestroyed())window.webContents.forcefullyCrashRenderer();}
  catch{}finally{unresponsive=null;}
 });
 window.on('responsive',()=>unresponsive?.abort());
 claudeCliUsage=createClaudeCliUsage();
 claudeWeb=new ClaudeWeb({BrowserWindow,parent:window,openPage:(url,options)=>openWorkspacePage(url,{...options,authentication:true,httpsOnly:true,session:session.fromPartition('persist:nubi-claude-web')}),closePage:tabId=>{if(browserHost?.tabs.has(tabId))browserHost.closeTab(tabId,{returnToApp:true});}});
 browserHost=new BrowserHost(window,{partition:'persist:nubi-browser-workspace',onFault:recordFault,loginCode:()=>{const device=host.account.device;return device&&device.expiresAt>Date.now()?device.code:null;}});
 externalBrowser=new ExternalBrowserHost({onChange:state=>{hostEvent({type:'external_browser_changed',state});if(!state.connected&&browserDock?.automationReady){browserDock.automationReady=false;browserDock.publish();}if(!state.connected&&externalMailPortal?.state.connected)void externalMailPortal.failSession(Error('mail_portal_login')).catch(()=>{});}});
 browserLaunch=new BrowserLaunch({storage,dialog,shell:require('electron').shell,parent:window});await browserLaunch.load();
 browserRouter=new BrowserRouter({internal:browserHost,external:externalBrowser,launch:browserLaunch,notify:hostEvent});browserRouter.internalPlaywright=new PlaywrightHost(browserHost);
 browserContentPort=createExternalBrowserContentPort({browser:externalBrowser,router:browserRouter,window,Menu,clipboard,directFactory:async()=>{
  if(process.platform!=='win32')return new ChromeDirectConnection();
  const installation=await samsungInstallation();browserLaunch.connectionExecutable=installation.executable||browserLaunch.preference.executable;
  return new ChromeDirectConnection({portFile:()=>samsungPortFile({userDataDir:installation.userDataDir})});
 }});
 browserDock=new BrowserWindowDock({native:new BrowserWindowNative({directory:path.join(app.isPackaged?process.resourcesPath:__dirname,'browser-window-bridge'),parent:window}),external:externalBrowser,launch:browserLaunch,notify:event=>{if(event.type==='external_browser_opened'){window.show();window.focus();}hostEvent(event);}});browserRouter.dock=browserDock;
 officeDock=new OfficeWindowDock({native:new BrowserWindowNative({directory:path.join(app.isPackaged?process.resourcesPath:__dirname,'browser-window-bridge'),parent:window}),identity:args=>invoke('_externalOffice',{...args,action:'window'}),notify:hostEvent});
 window.on('close',event=>{if(!quitting&&browserDock){event.preventDefault();app.quit();}});
 playwrightHost={request:(action,args,options)=>browserRouter.playwright(action,args,options),dispose(){browserRouter.internalPlaywright.dispose();externalBrowser.playwright.dispose();}};
 const externalMailPortal=new ExternalMailPortal({BrowserWindow,invoke,parent:window,browser:externalBrowser,onDisconnected:notice=>mailLoginNotices.show(notice)});
 mailPortal=externalMailPortal;
 window.webContents.setWindowOpenHandler(({url})=>{
  openPageLink(url);
  return {action:'deny'};
 });
 const dispatch=async(method,args={},source='electron')=>{try{
  if(installingUpdate&&method!=='workspaceUpdate')throw Error('update_installing');
  if(method==='windowLayout'){
   if(source!=='electron')throw Error('window_layout_desktop_only');
   if(browserDock&&['preparing','attaching','docked','detaching'].includes(browserDock.phase))return {changed:false};
   return windowExpansion.layout(args);
  }
  if(method==='workspaceUpdate'){
   if(source!=='electron')throw Error('update_desktop_only');
   updater??=new WorkspaceUpdater({account:host.account,directory:path.join(app.getPath('userData'),'updates'),version:app.getVersion()});
   if(args.action==='status')return updater.status();
   if(args.action==='check')return await updater.check();
   if(args.action==='download'){void updater.download().catch(()=>{});return updater.status();}
   if(args.action==='cancel')return updater.cancel();
   if(args.action==='install'){
    if(!app.isPackaged||process.platform!=='win32')throw Error('update_windows_only');
    if(mailPortal?.status().checking||mailPortal?.status().connecting||terminalHost?.sessions.size||terminalHost?.opens.size||openingProject||host.wikis?.busy)throw Error('update_work_active');
    const installer=await updater.installer();
    if(mailPortal?.status().checking||mailPortal?.status().connecting||terminalHost?.sessions.size||terminalHost?.opens.size||openingProject||host.wikis?.busy)throw Error('update_work_active');
    installingUpdate=true;
    try{await invoke('prepareAppUpdate');}catch(error){installingUpdate=false;throw error;}
    // NSIS's existing update mode skips the wizard and restarts after success.
    app.once('quit',()=>{const child=spawn(installer,['/S','--updated','--force-run'],{detached:true,stdio:'ignore',windowsHide:true,shell:false});child.on('error',()=>recordFault('update-installer',{reason:'launch-failed'}));child.unref();});
    setTimeout(()=>app.quit(),100);return {installing:true};
   }
   throw Error('method_invalid');
  }
  if(method==='decisionNotice'){if(source!=='electron')throw Error('decision_desktop_only');return decisionNotices.request(args);}
  if(method==='titlebarAppearance'){if(source!=='electron')throw Error('titlebar_desktop_only');openingCaption.appearance(args);return {updated:true};}
  if(method==='openingScene'){if(source!=='electron')throw Error('titlebar_desktop_only');openingCaption.opening(args.active);return {updated:true};}
  if(method==='startupConnections'){const preparation=prepareNativeInput(window);let mail=null;try{mail=await portalMailStatus();}catch{}const nativeInput=await preparation;return {launchId,mailPrompt:startupMailPrompt(mail),nativeInput};}
  if(method==='browserMirror'){if(source!=='electron')throw Error('browser_desktop_only');return await browserContentPort.request(args);}
  if(method==='browserConnection'){
   if(source!=='electron')throw Error('browser_desktop_only');
   if(args.action==='status')return browserRouter.configuration();
   if(args.action==='pair')return await externalBrowser.pair();
   if(args.action==='copyPair'){const paired=await externalBrowser.pair();clipboard.writeText(paired.code);return {copied:true,expiresAt:paired.expiresAt};}
   if(args.action==='extensionFolder'){require('electron').shell.showItemInFolder(path.join(app.isPackaged?process.resourcesPath:__dirname,'browser-connector','manifest.json'));return {opened:true};}
   if(args.action==='dockBring')return await browserDock.bring({source:'button'});
   if(args.action==='dockDetach')return await browserDock.detach();
   if(args.action==='dockCancel')return await browserDock.cancel();
   if(args.action==='dockLayout'){
    const b=args.bounds;if(!b||!['x','y','width','height'].every(k=>Number.isFinite(b[k]))||b.x<0||b.y<0)throw Error('dock_bounds_invalid');
    const content=window.getContentBounds();if(b.x+b.width>content.width+2||b.y+b.height>content.height+2)throw Error('dock_bounds_invalid');
    const absolute={x:Math.round(content.x+b.x),y:Math.round(content.y+b.y),width:Math.round(b.width),height:Math.round(b.height)};
    const bounds=process.platform==='win32'?require('electron').screen.dipToScreenRect(window,absolute):absolute;
    return await browserDock.layout({...args,bounds});
   }
   if(args.action==='selectExecutable'){if(browserDock.phase==='docked'||browserDock.operation)await browserDock.cancel();await browserDock.native.close();return await browserLaunch.select();}
   if(args.action==='focus')return await externalBrowser.focus(args.tabId);
   if(args.action==='disconnect'){await browserDock.cancel();if(mailPortal.status().connected||mailPortal.status().connecting)await mailPortal.disconnect();await externalBrowser.stop();return browserRouter.configuration();}
   if(args.action==='mode'){if(args.mode===browserLaunch.preference.mode)return browserRouter.configuration();if(mailPortal.status().connected||mailPortal.status().connecting||mailPortal.status().checking)throw Error('mail_browser_busy');return await browserRouter.setMode(args.mode);}
   throw Error('browser_action_invalid');
  }
  if(method==='browser'){if(source!=='electron')throw Error('browser_desktop_only');return await browserRouter.ui(args);}
  if(method==='openWorkspacePage')return await openWorkspacePage(args.url);
  if(!DESKTOP_FEATURES.computerUse&&method==='chooseComputerApp')throw Error('computer_beta_disabled');
  if(method==='openCurrent')return await restoreCurrentProject();
  if(method==='startConversation'){const root=path.join(storage,'conversations');await mkdir(root,{recursive:true});return await openProject(root,'conversation',{progressId:args.progressId});}
  if(method==='projectCatalog'){
   if(args.action==='rename')return await projectCatalog.rename(args.id,args.name);
   if(args.action==='remove'){if((await projectCatalog.list()).some(project=>project.id===args.id&&project.root===currentRoot)||(await invoke('projectActivity',{projectId:args.id})).active)throw Error('project_active');return await projectCatalog.remove(args.id);}
   if(args.action&&args.action!=='list')throw Error('method_invalid');
   return await projectCatalog.list();
  }
  if(method==='switchProject'){const saved=await projectCatalog.get(args.id);return await openProject(saved.root,saved.kind==='conversation'?'conversation':'project',{progressId:args.progressId});}
  if(method==='chooseFolder'){const root=await choose(['openDirectory'],'프로젝트 폴더 열기');return root?await openProject(root,'project',{sourceKind:'local',progressId:args.progressId}):{cancelled:true};}
  if(['browseLocalDirectory','readLocalFile'].includes(method)){const owner=await invoke('projectPath',{projectId:args.projectId});const value=await (method==='browseLocalDirectory'?browseLocalDirectory:readLocalFile)(args.path);if(currentRoot!==owner.path)throw Error('project_changed');return value;}
  if(method==='copyProjectPath'){const result=await invoke('projectPath',args);clipboard.writeText(result.path);return result;}
  if(method==='saveDocumentCopy'){if(source!=='electron')throw Error('editor_desktop_only');const owner=currentRoot;return require('./save-document-copy.cjs').saveDocumentCopy(args,{choose:(filename,kind)=>dialog.showSaveDialog(window,{title:'수정한 사본 저장',defaultPath:path.join(app.getPath('downloads'),filename),filters:[{name:kind.toUpperCase(),extensions:[kind]}],buttonLabel:'사본 저장'}),current:()=>currentRoot===owner&&!window.isDestroyed()});}
  if(method==='exportConversation'){
   if(source!=='electron')throw Error('editor_desktop_only');
   const owner=currentRoot,packet=await invoke('exportConversation',args),bytes=Buffer.from(packet.markdown,'utf8'),expected=createHash('sha256').update(bytes).digest('hex');
   const saved=await dialog.showSaveDialog(window,{title:'대화 Markdown 내보내기',defaultPath:path.join(app.getPath('downloads'),packet.filename),filters:[{name:'Markdown',extensions:['md']}],buttonLabel:'저장'});
   if(saved.canceled||!saved.filePath)return {cancelled:true};
   if(currentRoot!==owner)throw Error('project_changed');
   await writeFile(saved.filePath,bytes,{mode:0o600});
   if(createHash('sha256').update(await readFile(saved.filePath)).digest('hex')!==expected)throw Error('대화 파일 저장을 확인하지 못했어요. 저장한 파일을 확인해 주세요.');
   return {saved:true,filename:path.basename(saved.filePath)};
  }
  if(method==='downloadMail'){
   const packet=await invoke('mail',{action:'download',id:args.id,kind:args.kind,attachmentId:args.attachmentId,expectedSourceHash:args.expectedSourceHash,expectedAttachmentHash:args.expectedAttachmentHash,innerAttachmentId:args.innerAttachmentId,expectedInnerHash:args.expectedInnerHash});
   const bytes=Buffer.from(packet.bytes,'base64');if(bytes.length!==packet.size||createHash('sha256').update(bytes).digest('hex')!==packet.sha256)throw Error('mail_source_changed');
   const saved=await dialog.showSaveDialog(window,{title:'메일 다운로드',defaultPath:path.join(app.getPath('downloads'),packet.filename),buttonLabel:'저장'});if(saved.canceled)return {cancelled:true};
   await writeFile(saved.filePath,bytes,{mode:0o600});if(createHash('sha256').update(await readFile(saved.filePath)).digest('hex')!==packet.sha256){await rm(saved.filePath,{force:true}).catch(()=>{});throw Error('mail_download_unconfirmed');}
   return {saved:true,filename:path.basename(saved.filePath)};
  }
  if(method==='importMailFolder'){if(source!=='electron')throw Error('mail_portal_desktop_only');const directory=await choose(['openDirectory'],'메일 파일 폴더 선택');return directory?invoke('mail',{action:'importFolder',directory}):{cancelled:true};}
  if(method==='mail'){
   if(args.action==='selectMethod'){
    if(source!=='electron')throw Error('mail_portal_desktop_only');
    if(!['desktop','pop3','portal'].includes(args.method))throw Error('mail_input_invalid');
    const portal=mailPortal.status();if(portal.connecting||portal.checking)throw Error('mail_busy');
    const previous=await invoke('mail',{action:'status',includeMessages:false});
    const selected=await invoke('mail',{action:'selectMethod',method:args.method});
    if(portal.connected&&previous.connectionMethod!==args.method)await mailPortal.disconnect();
    return portalMailStatus(selected);
   }
   if(['desktopConnect','desktopSync'].includes(args.action)){
    if(source!=='electron')throw Error('mail_desktop_only');
    if(args.action==='desktopConnect'){
     await mailPortal.disconnect();mailLoginNotices.clear();
    }
    return portalMailStatus(await invoke('mail',{action:args.action,...(typeof args.profileId==='string'?{profileId:args.profileId}:{})}));
   }
   // POP3 is an independent user-selected method; credentials remain memory-only.
   if(args.action==='connect'){
    if(source!=='electron')throw Error('mail_portal_desktop_only');
    if(args.serverProfile!=='company')throw Error('mail_portal_only');
    const portal=mailPortal.status();if(portal.connected||portal.connecting||portal.checking)throw Error('mail_busy');
    if((await invoke('mail',{action:'status',includeMessages:false})).connectionMethod!=='pop3')throw Error('mail_method_changed');
    return await portalMailStatus(await invoke('mail',{action:'connect',requestId:args.requestId,serverProfile:'company',user:args.user,password:args.password,...(args.destination?{destination:args.destination}:{}),...(args.recipientAddress?{recipientAddress:args.recipientAddress}:{}),...(typeof args.rememberUser==='boolean'?{rememberUser:args.rememberUser}:{})}));
   }
   if(args.action==='setIdentity')throw Error('mail_portal_only');
   if(/^portal(?:Connect|Import|Folders|Known|Rejected|Document)$/.test(args.action||'')||['download','importFolder','usePortalSource'].includes(args.action))throw Error('method_invalid');
   if(['portalSync','check','retryDownloads'].includes(args.action)&&(await invoke('mail',{action:'status',includeMessages:false})).connectionMethod==='desktop')return portalMailStatus(await invoke('mail',{action:'desktopSync'}));
   if(['approvals','approvalRead','approvalTitle'].includes(args.action)&&(await invoke('mail',{action:'status',includeMessages:false})).connectionMethod==='desktop')throw Error('mail_desktop_archive_only');
   if(args.action==='approvals')return await mailPortal.approvals(args);
   if(args.action==='approvalRead')return await mailPortal.approvalRead(args);
   if(args.action==='approvalTitle')return await mailPortal.approvalTitle(args);
   if(args.action==='portalCredentials')throw Error('method_invalid');
   if(args.action==='portalSession'){
    if(source!=='electron')throw Error('mail_portal_desktop_only');
    await invoke('mail',{action:'usePortalSource'});
    const result=await mailPortal.sessionReady();
    if(result.connected){mailLoginNotices.reset();hostEvent({type:'mail_portal_connected',requiresStorageSetup:(await invoke('mail',{action:'status',includeMessages:false})).requiresStorageSetup});}
    return {...await portalMailStatus(),requiresLogin:result.requiresLogin===true};
   }
   if(args.action==='portalLogin'){
    if(source!=='electron')throw Error('mail_portal_desktop_only');mailPortal.requestId=args.requestId;
    await browserRouter.setMode('external');browserRouter.externalFocus=true;hostEvent({type:'external_browser_opened',state:browserRouter.configuration()});
    await invoke('mail',{action:'usePortalSource'});
    try{await mailPortal.connect({destination:args.destination});}catch(error){if(!['mail_cancelled','external_browser_connection_required','external_browser_portal_permission_required'].includes(error.message))hostEvent({type:'mail_portal_failed',error:/^mail_[a-z_]+$/.test(error.message)?error.message:'mail_portal_request'});throw error;}
    mailLoginNotices.reset();hostEvent({type:'mail_portal_connected',requiresStorageSetup:(await invoke('mail',{action:'status',includeMessages:false})).requiresStorageSetup});return portalMailStatus();
   }
   // Cancel stops whatever portal connection is running, even when the screen that asked was reopened and no longer
   // holds the request id (user report 2026-10-14: 연결 취소 kept connecting).
   if(args.action==='cancelConnect'){if((await invoke('mail',{action:'status',includeMessages:false})).connectionMethod!=='portal')return portalMailStatus(await invoke('mail',{action:'cancelConnect',...(typeof args.requestId==='string'?{requestId:args.requestId}:{})}));if(args.requestId===mailPortal.requestId||mailPortal.status().connecting)await mailPortal.disconnect();return portalMailStatus();}
   if(args.action==='reset'){if(source!=='electron'||args.confirmed!==true)throw Error('mail_reset_confirmation');if(resettingData||wikiLibrary.writes.size)throw Error('mail_busy');resettingData=true;try{await mailPortal.disconnect();await invoke('mail',args);Object.assign(mailPortal.state,{folders:[],lastCheckedAt:null,completed:0,total:null,discovered:0});mailPortal.approvalCacheBytes=0;hostEvent({type:'mail_data_reset'});return await portalMailStatus();}finally{resettingData=false;}}
   if(args.action==='disconnect'){await mailPortal.disconnect();await mailPortal.clearPortalSession();mailLoginNotices.clear();return portalMailStatus();}
   if(args.action==='confirmStorage'){if(source!=='electron')throw Error('mail_desktop_only');await invoke('mail',{action:'confirmStorage',includeAttachments:args.includeAttachments});if(mailPortal.status().connected)void mailPortal.sync().catch(()=>{});return portalMailStatus();}
   if(args.action==='portalSync'||['check','retryDownloads'].includes(args.action)&&mailPortal.status().connected){await mailPortal.recheck();return portalMailStatus();}
   if(['pauseWatch','resumeWatch'].includes(args.action)){await invoke('mail',args);if(args.action==='pauseWatch')clearTimeout(mailPortal.timer);else if(mailPortal.status().connected)void mailPortal.sync().catch(()=>{});return portalMailStatus();}
   if(args.action==='attention'){const page=await invoke('mail',args);return {...page,status:await portalMailStatus(page.status)};}
   if(args.action==='status'||args.action===undefined)return portalMailStatus(null,{includeMessages:args.includeMessages!==false});
  }
  // The person picks where mail and attachment originals live; the mail runtime moves what is already there.
  if(method==='chooseMcpFolder'){if(source!=='electron')throw Error('mcp_desktop_only');const directory=await choose(['openDirectory'],'MCP 서버 작업 폴더');return directory?{path:directory}:{cancelled:true};}
  if(method==='chooseMailRawRoot'){
   if(source!=='electron')throw Error('mail_desktop_only');if(mailPortal.status().checking)throw Error('mail_busy');
   const directory=await choose(['openDirectory','createDirectory'],'메일 원문과 첨부파일 저장 위치');if(!directory)return {cancelled:true};
   if(mailPortal.status().checking)throw Error('mail_busy');clearTimeout(mailPortal.timer);
   try{
    const job=await invoke('mail',{action:'startRawMove',directory,includeAttachments:args.includeAttachments});
    for(;;){const value=await invoke('mail',{action:'storageProgress',id:job.id});if(!value.moving){if(value.progress?.state!=='completed')throw Error(value.progress?.error||'mail_storage_failed');break;}await new Promise(resolve=>setTimeout(resolve,400));}
   }
   finally{if(mailPortal.status().connected)void mailPortal.sync().catch(()=>{});}
   return portalMailStatus();
  }
  if(method==='copyMailStoragePath'){
   if(!['raw','wiki'].includes(args.kind))throw Error('mail_storage_kind_invalid');
   const status=await invoke('mail',{action:'status'}),storagePath=args.kind==='raw'?status.rawRoot:status.wikiRoot;
   if(typeof storagePath!=='string'||!path.isAbsolute(storagePath))throw Error('mail_storage_unavailable');
   clipboard.writeText(storagePath);return {path:storagePath};
  }
  if(method==='importProject'){const file=await choose(['openFile'],'프로젝트 ZIP 업로드',[{name:'ZIP',extensions:['zip']}]);if(!file)return {cancelled:true};const parent=await choose(['openDirectory'],'프로젝트를 저장할 폴더');if(!parent)return {cancelled:true};projectOpenProgress(args.progressId,'extracting');return await openProject((await importProjectZip(file,parent)).root,'project',{sourceKind:'local',progressId:args.progressId});}
  if(method==='cloneRepository'){const parent=await choose(['openDirectory'],'프로젝트를 저장할 폴더');if(!parent)return {cancelled:true};return await openProject((await host.clone({...args,parent},progress=>hostEvent({type:'git_clone_progress',requestId:typeof args.progressId==='string'?args.progressId.slice(0,64):null,...progress}))).root,'project',{exactRoot:true,sourceKind:'remote',progressId:args.progressId});}
  if(method==='ghesAccount'){const state=await host.accountAction(args.operation);if(args.operation==='copy'){if(!state.device?.code)throw Error('copy_unavailable');clipboard.writeText(state.device.code);}return state;}
  if(method==='claudeCliUsage'){if(source!=='electron')throw Error('claude_cli_desktop_only');if(args.action==='read')return claudeCliUsage.read();return claudeCliUsage.status();}
  if(method==='claudeWeb'){if(source!=='electron')throw Error('claude_web_desktop_only');if(args.action==='connect')return claudeWeb.connect();if(args.action==='refresh')return claudeWeb.refresh();if(args.action==='disconnect')return claudeWeb.disconnect();return claudeWeb.status();}
  if(method==='ghesRepositories')return host.listRepositories();
  if(method==='connectMarketplace')return host.connectMarketplace();
  if(method==='openTeamWorkspace')return host.openTeamWorkspace(args);
  if(method==='workspaceCommunity'){if(source!=='electron')throw Error('wiki_share_desktop_only');return host.community.call(args);}
  // The vendored AI Workspace screens (apps, Talk) call company GitHub through the SSO session kept here: only the
  // ai_workspace repository, users and GraphQL routes, bounded bodies, the caller's Authorization dropped (2026-10-14).
  if(method==='ghesFetch'){
   if(source!=='electron')throw Error('ghes_desktop_only');
   workspaceFetch??=require('./workspace-fetch.cjs').createWorkspaceFetch(host.account);return workspaceFetch(args);
  }
  if(method==='openWorkspaceApp'){if(source!=='electron')throw Error('wiki_share_desktop_only');const item=await host.community.call({action:'app',id:args.id});if(item.kind==='link')return openWorkspacePage(item.url);const workspace=await host.openTeamWorkspace();return openWorkspacePage(require('./workspace-community.cjs').workspaceAppUrl(workspace.url,item.id));}
  if(method==='wikiInitialization'&&args.action==='reset'){if(source!=='electron'||args.confirmed!==true)throw Error('wiki_reset_confirmation');if(resettingData||wikiLibrary.writes.size)throw Error('wiki_busy');resettingData=true;try{return await invoke(method,args);}finally{resettingData=false;}}
  if(method==='wikiLibrary'){if(source!=='electron')throw Error('wiki_share_desktop_only');return wikiLibrary.call(args);}
  if(method==='wikiRepository'){
   if(source!=='electron')throw Error('wiki_share_desktop_only');
   const service=host.wikiRepository;
   if(args.action==='list')return await service.list();
   if(args.action==='people')return await service.people(args);
   if(args.action==='detail')return await service.detail(args);
   if(args.action==='progress')return service.progress;
   if(args.action==='cancel'){service.cancel();return {cancelled:true};}
   if(args.action==='stage'){const directory=await choose(['openDirectory'],'공유할 위키 문서 폴더');return directory?await service.stage(directory):{cancelled:true};}
   if(args.action==='publish')return await service.publish(args);
   if(args.action==='download'){const directory=await choose(['openDirectory'],'위키를 저장할 폴더');return directory?await service.download(args,directory):{cancelled:true};}
   throw Error('method_invalid');
  }
  if(method==='openBrowser')return openWorkspacePage(args.url);
  if(method==='editorConnectorFolder'){if(source!=='electron')throw Error('editor_desktop_only');require('electron').shell.showItemInFolder(path.join(app.isPackaged?process.resourcesPath:__dirname,'obsidian-connector','manifest.json'));return {opened:true};}
  if(method==='officeDock'){
   if(source!=='electron'||process.platform!=='win32')throw Error('native_office_windows_required');
   if(args.action==='show'){await browserDock?.detach();return await officeDock.show({projectId:args.projectId||args._projectId,taskId:args.taskId});}
   if(args.action==='detach')return await officeDock.detach();
   if(args.action==='layout'){
    const b=args.bounds,c=window.getContentBounds();if(!b||!['x','y','width','height'].every(k=>Number.isFinite(b[k]))||b.x<0||b.y<0||b.width<0||b.height<0||b.x+b.width>c.width+2||b.y+b.height>c.height+2)throw Error('dock_bounds_invalid');
    const bounds=require('electron').screen.dipToScreenRect(window,{x:Math.round(c.x+b.x),y:Math.round(c.y+b.y),width:Math.round(b.width),height:Math.round(b.height)});return await officeDock.layout({...args,bounds});
   }
   throw Error('dock_action_invalid');
  }
  if(method==='externalOffice'){
   if(source!=='electron')throw Error('native_office_desktop_only');
   if(!['preview','select','stage','attach','cancel','status','disconnect','save','checkpoints','restore'].includes(args.action))throw Error('native_office_method_invalid');
   if(['disconnect','restore','attach'].includes(args.action))await officeDock?.detach();
   return await invoke('_externalOffice',{action:args.action,app:args.app,taskId:args.taskId,token:args.token,candidateId:args.candidateId,checkpointId:args.checkpointId,confirmed:args.confirmed,projectId:args.projectId||args._projectId});
  }
  if(method==='chooseChatDocuments'){
   if(source!=='electron')throw Error('document_scope');
   const owner=await invoke('projectPath',{projectId:args.projectId});
   const result=await dialog.showOpenDialog(window,{title:'질문할 문서 선택',properties:['openFile','multiSelections'],filters:[{name:'문서',extensions:['pdf','doc','docx','docm','dotx','dotm','xls','xlsx','xlsm','xltx','xltm','ppt','pptx','pptm','ppsx','ppsm','potx','potm','txt','md','csv','json','xml','html','htm','ics']}]});
   if(result.canceled)return {cancelled:true};
   if(currentRoot!==owner.path)throw Error('project_changed');
   return invoke('importDocumentSelection',{projectId:args.projectId,paths:result.filePaths});
  }
  if(method==='chooseSkillPackage'){const folder=args.kind==='folder',mixed=!folder&&args.kind!=='zip'&&process.platform==='darwin';const file=await choose(folder?['openDirectory']:mixed?['openFile','openDirectory']:['openFile'],'스킬 등록',folder?undefined:[{name:'스킬',extensions:['zip','md']}]);return file?invoke('importSkill',{source:file,taskId:args.taskId}):{cancelled:true};}
  if(method==='chooseComputerApp'){const file=await choose(['openFile'],'Windows 앱 선택',[{name:'Windows app',extensions:['exe']}]);return file?invoke('computer',{method:'register_app',taskId:args.taskId,file}):{cancelled:true};}
  if(forbidden.has(method))throw Error('method_invalid');return await invoke(method,args);
 }catch(error){return {__nubiError:/^[a-z_]+$/.test(error.message)?error.message:'operation_failed',...(method==='mail'&&['approvals','approvalRead','approvalTitle'].includes(args.action)&&safeApprovalFailure(error.approvalFailure)?{approvalFailure:safeApprovalFailure(error.approvalFailure)}:{}),...(method==='cloneRepository'&&safeCloneFailure(error.cloneFailure)?{cloneFailure:safeCloneFailure(error.cloneFailure)}:{})};}};
 const terminalLog=boundedLog({file:path.join(storage,'terminal.log')});
 terminalHost=new TerminalHost({invoke,onDiagnostic:event=>terminalLog(JSON.stringify({at:Date.now(),...event})+'\n'),profiles:shellProfiles,workerFile:path.join(__dirname,'terminal-worker.cjs'),notify:event=>{if(window&&!window.isDestroyed()&&!window.webContents.isDestroyed())window.webContents.send('nubi:terminal-event',event);}});
 ipcMain.handle('nubi:terminal',async(event,args)=>{trusted(event);try{if(installingUpdate)throw Error('update_installing');return await terminalHost.request(args);}catch(error){return {__nubiError:/^[a-z_]+$/.test(error.message)?error.message:'terminal_start_failed'};}});
 ipcMain.handle('nubi:request',(event,method,args={})=>{trusted(event);return dispatch(method,args);});
 ipcMain.handle('nubi:skill-file',async(event,args={})=>{trusted(event);try{
   if(typeof args.source!=='string'||!path.isAbsolute(args.source)||args.source.length>4000||args.taskId!==undefined&&args.taskId!==null&&typeof args.taskId!=='string')throw Error('skill_import_path');
   return await invoke('importSkill',{source:args.source,taskId:args.taskId});
 }catch(error){return {__nubiError:/^[a-z_]+$/.test(error.message)?error.message:'operation_failed'};}});
 // The local web host is optional: a busy port is recorded and the window still loads (2026-10-07; it hung before).
 if(process.env.NUBI_WEB_PORT){try{webHost=await startWebHost({frontend,dispatch:(method,args)=>dispatch(method,args,'web'),port:Number(process.env.NUBI_WEB_PORT)});console.log(`Nubi live workspace: ${webHost.origin}`);}catch(error){recordFault('web-host',{reason:'launch-failed',code:error.code||error.message});console.error('누비 로컬 웹을 열지 못했어요: '+(error.code||error.message));}}
 await window.loadURL('app://bundle/index.html');
});
app.on('window-all-closed',()=>app.quit());
// Quitting waits for the worker to exit (bounded by its kill grace): the worker releases the project store lock with its
// process, so a relaunch right after quit can open the same project instead of failing with project_locked.
let quitting=false;app.on('before-quit',event=>{if(quitting)return;quitting=true;event.preventDefault();terminalHost?.dispose();playwrightHost?.dispose();browserContentPort?.dispose();browserHost?.dispose();mailPortal?.dispose();claudeWeb?.dispose();void webHost?.close();host?.dispose?.();Promise.resolve(officeDock?.dispose()).catch(()=>{}).then(()=>browserDock?.dispose()).catch(()=>{}).then(()=>externalBrowser?.dispose()).then(()=>worker?.stop()).catch(()=>{}).then(()=>vault.flush()).then(()=>Promise.race([notificationHistory.flush(),new Promise(resolve=>setTimeout(resolve,1000))])).then(()=>app.quit());});
