import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {GhesAvatar} from '../ui/GhesAccount.jsx';
import {WikiRepository} from '../ui/WikiRepository.jsx';
import {WorkspaceActivity} from '../ui/WorkspaceActivity.jsx';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../design/workspace-typography.css';
import '../design/workspace-dialogs.css';
const item={id:'00000000-0000-4000-8000-000000000001',title:'서비스 운영 위키',description:'서비스 구조와 운영 방법',mode:'code',version:'1.0.0',managers:[],createdBy:'alice',updatedBy:'alice',createdAt:'2026-10-13T01:02:00Z',updatedAt:'2026-10-13T01:02:00Z',canEdit:true,audience:{scope:'repository',readers:[]},releases:[{version:'1.0.0',createdAt:'2026-10-13T01:02:00Z'}]};
window.wikiCalls=[];
const api=async(_name,args)=>{window.wikiCalls.push(args);if(args.action==='list')return {head:'fixture',canUpload:true,items:[item,{...item,id:'00000000-0000-4000-8000-000000000002',mode:'personal',title:'개인 업무 위키'}]};if(args.action==='people'){await new Promise(r=>setTimeout(r,args.query==='old'?800:20));return {items:args.query==='none'?[]:[{login:'bob',name:'김누비',email:'bob@example.test',company:'개발팀'},{login:'carol',name:'이누비',email:'carol@example.test',company:'운영팀'}]};}if(args.action==='detail')return {manifest:{files:[]}};if(args.action==='publish'){item.audience=args.metadata.audience;return {saved:true};}return {};};
function App(){const [status,setStatus]=useState({emoji:'😄',message:'집중 중'});window.setProfileStatus=setStatus;const profile={name:'Alice',login:'alice',avatar:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZHcAAAAASUVORK5CYII=',status};return <main className="nubi-account-control"><div className="desktop-shell" hidden/><div className="nubi-account-button"><GhesAvatar profile={profile}/></div><div className="nubi-account-profile"><GhesAvatar profile={profile}/></div><WikiRepository api={api}/><WorkspaceActivity task={{id:'test',state:'paused',responseTiming:{runId:'12345678-1234-4123-8123-123456789abc'},trace:[{id:'12345678-1234-4123-8123-123456789abc:review:0',runId:'12345678-1234-4123-8123-123456789abc',tool:'review_task',status:'error',reason:'review_json_invalid'}]}}/></main>;}
createRoot(document.getElementById('root')).render(<App/>);
