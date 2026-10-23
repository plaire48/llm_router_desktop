import '@e2e/cx-design-system/styles.css';
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DetailPanel,CxButton} from '@e2e/cx-design-system';
import {MailLibrary} from '../ui/MailLibrary.jsx';
import {WorkspaceToast} from '../ui/WorkspaceToast.jsx';

import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
import '../design/workspace-icons.css';
// The '메일 설정' dialog of the Workbench: MailLibrary inside a DetailPanel, with the toast host that shows its action errors.
// Two ways in (2026-10-14): the portal login and a folder of saved mail files. The POP3 fallback is only exposed after a host-reported portal failure.
window.mailCalls=[];window.mailFail=false;window.mailSlow=false;
const status={serverProfile:'company',protocol:'portal',encryption:{state:'on',migration:{state:'completed'}},connected:false,connecting:false,autoWiki:true,watchPaused:false,checking:false,summarizing:false,readingAttachments:false,counts:{received:0,queued:0,saved:0,attention:0},messages:[],storageRoot:'/fixture/personal',wikiRoot:'/fixture/personal/wiki',rawRoot:'/fixture/personal/raw',baselineCount:0,catalogs:[{provider:'aipro',models:[{id:'fixture',label:'Fixture'}]}],destination:null,localImport:null,localCount:0,localKinds:[]};
const desktopCase=new URLSearchParams(location.search).get('desktop');
if(desktopCase)status.desktop={mode:'desktop',transport:'uia',storageMode:'desktop_uia',supported:desktopCase!=='unsupported',connected:false,connecting:false,checking:false,error:null,profiles:[],rawRoot:status.rawRoot};
if(['portal-compat','pop3-compat'].includes(desktopCase)){status.connectionMethod=desktopCase.split('-')[0];status.localCount=1;status.counts.received=1;status.localKinds=['other'];}
// ?pop3User=: a login ID the host remembered. ?portal=1: the portal login, kept in code but off in the product (2026-10-23).
const fixtureParams=new URLSearchParams(location.search);if(fixtureParams.get('pop3User'))status.pop3User=fixtureParams.get('pop3User');
window.setMailImportFixture=progress=>{status.localImport=progress;};
async function api(method,args={}){
 if(method==='importMailFolder'){window.mailCalls.push({action:'importMailFolder'});status.localImport={state:'completed',total:1,completed:1,imported:1,duplicates:0,failures:[],startedAt:new Date().toISOString()};status.localCount=1;status.localKinds=['AUTO_INBOX','other'];return structuredClone(status);}
 if(method==='copyMailStoragePath')return {copied:true};
 if(method==='chooseMailRawRoot'){window.mailCalls.push({action:'chooseMailRawRoot'});status.rawRoot='/fixture/selected/uia-originals';if(status.desktop)status.desktop.rawRoot=status.rawRoot;return structuredClone(status);}
 if(method!=='mail')throw Error('fixture_method');
 if(args.action==='status')return structuredClone(status);
 window.mailCalls.push(structuredClone(args));
 if(args.action==='desktopConnect'){
  if(desktopCase==='multiple'&&!args.profileId){status.desktop.requiresSelection=true;status.desktop.profiles=[{id:'one',label:'Knox Desktop 첫 창'},{id:'two',label:'Knox Desktop 다른 창'}];}
  else{status.connected=true;Object.assign(status.desktop,{connected:true,requiresSelection:false,profileId:args.profileId||'one',label:args.profileId==='two'?'Knox Desktop 다른 창':'Knox Desktop 첫 창'});status.localCount=2;status.counts.received=2;status.localKinds=['other'];status.localImport=null;}
 }
 if(args.action==='desktopSync'){status.desktop.checking=false;}
 if(args.action==='pauseWatch')status.watchPaused=true;
 if(args.action==='resumeWatch')status.watchPaused=false;
 if(args.action==='resumeImport')status.localImport={...status.localImport,state:'importing',startedAt:new Date().toISOString()};
 if(args.action==='cancelImport')status.localImport={...status.localImport,state:'cancelled'};
 if(args.action==='connect'){await new Promise(resolve=>window.resolvePop3=resolve);if(window.pop3Fail){status.error='mail_auth';throw Error('mail_auth');}status.protocol='pop3';status.connected=true;status.error=null;if(status.desktop){status.desktop.mode='portal';status.desktop.connected=false;}}
 if(args.action==='portalLogin'){if(window.mailSlow){status.connecting=true;try{await new Promise(r=>window.releaseMail=r);}finally{status.connecting=false;}}if(window.mailFail){if(window.mailFallback)status.fallback='pop3';status.error=typeof window.mailFail==='string'?window.mailFail:'mail_portal_login';throw Error(status.error);}status.error=null;status.connected=true;status.counts={received:1,saved:1,queued:0,attention:0};status.messages=[{id:'one',subject:'계약 검토',state:'saved',from:'sender@fixture',fetchedAt:new Date().toISOString()}];status.destination=args.destination;status.nextCheckAt=new Date(Date.now()+60000).toISOString();}
 if(args.action==='reset'){if(args.confirmed!==true)throw Error('mail_reset_confirmation');status.connected=false;status.counts={received:0,saved:0,queued:0,attention:0};status.messages=[];status.localImport=null;status.localCount=0;status.localKinds=[];}
 if(args.action==='setAutoWiki')status.autoWiki=args.enabled;
 if(args.action==='disconnect'||args.action==='cancelConnect'){status.connected=false;if(status.desktop)status.desktop.connected=false;}
 return structuredClone(status);
}
// The library's 포털 로그인 button raises nubi-mail-login for the Workbench's login flow (2026-10-15); here the fixture plays
// that flow: it calls the host login and, like the real host, leaves a failure in the mail status for the library to show.
window.addEventListener('nubi-mail-login',()=>{void api('mail',{action:'portalLogin'}).catch(()=>{});});
function Fixture(){const [open,setOpen]=useState(true);return <div className="desktop-shell"><main className="nubi-workbench"><WorkspaceToast/><CxButton onClick={()=>setOpen(true)}>메일 열기</CxButton>{open&&<DetailPanel className="deck-dialog nubi-panel" title="메일 설정" variant="modal" onClose={()=>setOpen(false)}><MailLibrary api={api} provider={{connected:true,provider:'aipro',model:'fixture'}} portalEnabled={fixtureParams.get('portal')==='1'}/></DetailPanel>}</main></div>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
