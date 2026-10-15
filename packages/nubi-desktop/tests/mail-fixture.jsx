import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DetailPanel,CxButton} from '@e2e/cx-design-system';
import {MailLibrary} from '../ui/MailLibrary.jsx';
import {WorkspaceToast} from '../ui/WorkspaceToast.jsx';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
// The '메일 설정' dialog of the Workbench: MailLibrary inside a DetailPanel, with the toast host that shows its action errors.
// Two ways in (2026-10-14): the portal login and a folder of saved mail files. No password field exists any more.
window.mailCalls=[];window.mailFail=false;window.mailSlow=false;
const status={serverProfile:'company',protocol:'portal',encryption:{state:'on'},connected:false,connecting:false,autoWiki:true,watchPaused:false,checking:false,summarizing:false,readingAttachments:false,counts:{received:0,queued:0,saved:0,attention:0},messages:[],storageRoot:'/fixture/personal',wikiRoot:'/fixture/personal/wiki',rawRoot:'/fixture/personal/raw',baselineCount:0,catalogs:[{provider:'aipro',models:[{id:'fixture',label:'Fixture'}]}],destination:null,localImport:null,localCount:0,localKinds:[]};
async function api(method,args={}){
 if(method==='importMailFolder'){window.mailCalls.push({action:'importMailFolder'});status.localImport={state:'completed',total:1,completed:1,imported:1,duplicates:0,failures:[],startedAt:new Date().toISOString()};status.localCount=1;status.localKinds=['AUTO_INBOX','other'];return structuredClone(status);}
 if(method==='copyMailStoragePath')return {copied:true};
 if(method!=='mail')throw Error('fixture_method');
 if(args.action==='status')return structuredClone(status);
 window.mailCalls.push(structuredClone(args));
 if(args.action==='portalLogin'){if(window.mailSlow){status.connecting=true;try{await new Promise(r=>window.releaseMail=r);}finally{status.connecting=false;}}if(window.mailFail){status.error=typeof window.mailFail==='string'?window.mailFail:'mail_portal_login';throw Error(status.error);}status.error=null;status.connected=true;status.counts={received:1,saved:1,queued:0,attention:0};status.messages=[{id:'one',subject:'계약 검토',state:'saved',from:'sender@fixture',fetchedAt:new Date().toISOString()}];status.destination=args.destination;status.nextCheckAt=new Date(Date.now()+60000).toISOString();}
 if(args.action==='setAutoWiki')status.autoWiki=args.enabled;
 if(args.action==='disconnect'||args.action==='cancelConnect')status.connected=false;
 return structuredClone(status);
}
// The library's 포털 로그인 button raises nubi-mail-login for the Workbench's login flow (2026-10-15); here the fixture plays
// that flow: it calls the host login and, like the real host, leaves a failure in the mail status for the library to show.
window.addEventListener('nubi-mail-login',()=>{void api('mail',{action:'portalLogin'}).catch(()=>{});});
function Fixture(){const [open,setOpen]=useState(true);return <main className="nubi-workbench"><WorkspaceToast/><CxButton onClick={()=>setOpen(true)}>메일 열기</CxButton>{open&&<DetailPanel className="deck-dialog nubi-panel" title="메일 설정" variant="modal" onClose={()=>setOpen(false)}><MailLibrary api={api} provider={{connected:true,provider:'aipro',model:'fixture'}}/></DetailPanel>}</main>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
