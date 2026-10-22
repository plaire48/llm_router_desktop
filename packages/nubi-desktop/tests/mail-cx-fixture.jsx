import '@e2e/cx-design-system/styles.css';
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DetailPanel} from '@e2e/cx-design-system';
import {MailLibrary} from '../ui/MailLibrary.jsx';
import {MailBackground} from '../ui/MailBackground.jsx';
import {MailReader} from '../ui/MailReader.jsx';
import {DataResetConfirmation} from '../ui/DataResetConfirmation.jsx';

import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../ui/shell-state-auto.mjs';// layout facts as attributes, as the renderer host does (design light-flow §1.1)
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
import '../design/workspace-icons.css';
const query=new URLSearchParams(location.search),view=query.get('view')||'background';
const attachments=[{id:'calendar',filename:'검토 일정.ics',contentState:'document_read',coverage:'일정 본문',contentType:'text/calendar'},{id:'office',filename:'프로젝트 검토 보고서.docx',contentState:'document_attention',error:'document_office_policy'},{id:'text',filename:'회의 결과와 결정사항을 정리한 문서.txt',contentState:'document_read',coverage:'본문 텍스트'},{id:'notes',filename:'추가 확인이 필요한 주요 항목과 설명을 정리한 문서.md',contentState:'document_attention',error:'document_timeout'}];
const source={id:'fixture',sourceHash:'fixture-hash',local:{tags:[]},mail:{subject:'출시 검토 자료',from:'누비팀 <team@example.invalid>',to:'review@example.invalid',date:'2026-10-15T01:30:00Z',text:'출시 검토 자료를 전달합니다.\n첨부한 일정과 보고서를 확인해 주세요.',attachments}};
const status={connected:true,autoWiki:true,serverProfile:'portal',protocol:'portal',encryption:{state:'on'},counts:{received:4,saved:4,attention:2},progress:{stage:'attention'},catalogs:[],localCount:4,destination:null,rawRoot:'/fixture/mail/raw',wikiRoot:'/fixture/mail/wiki'};
const items=attachments.filter(item=>item.error).map(item=>({id:item.id,subject:source.mail.subject,sourceHash:'fixture-hash',summary:false,error:item.error,attachmentFailures:[{filename:item.filename,error:item.error}]}));
const api=async(method,args)=>args?.action==='confirmStorage'?Object.assign(status,{includeAttachments:args.includeAttachments}):args?.action==='attention'?{total:items.length,items,status,retrieval:{count:0}}:args?.action==='reset'?{...status,connected:false}:status;
function Fixture(){const [open,setOpen]=useState(true),close=()=>setOpen(false);return <main className="desktop-shell"><div className="desktop-agent"><div className="nubi-workbench" data-large-text={query.has('large')?'true':'false'}><div style={{padding:24}}>누비 Workspace Beta</div>{open&&(view==='background'?<MailBackground api={api} status={status} onStatus={()=>{}} onClose={close} onSettings={()=>{}} onOpenMessage={()=>{}}/>:view==='settings'?<DetailPanel title="메일 설정" variant="modal" className="deck-dialog nubi-panel" onClose={close}><MailLibrary api={api}/></DetailPanel>:view==='reset'?<DataResetConfirmation kind="mail" api={api} onClose={close} onDone={close}/>:<div className="nubi-mail-history-detail" style={{width:'min(100%,800px)',margin:'0 auto',background:'white'}}><MailReader source={source} api={api} onDocument={()=>{}} onAsk={()=>{}}/></div>)}</div></div></main>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
