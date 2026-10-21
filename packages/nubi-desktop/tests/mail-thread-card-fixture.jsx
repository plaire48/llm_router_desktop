import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/workbench.css';import '../electron-app/shell.css';import '../electron-app/ios-tokens.css';
import '../design/workspace-identity.css';import '../design/workspace-typography.css';import '../design/workspace-density.css';import '../design/workspace-dialogs.css';import '../design/workspace-icons.css';
import {MailReader} from '../ui/MailReader.jsx';
const api=async(method,args)=>{
 if(args.action==='threadCard'){
  if(window.failThread)throw Error('fixture_offline');
  return {count:65,firstAt:'2026-10-01',lastAt:'2026-10-21',participants:['team@example.test','review@example.test'],attachmentCount:7,state:'saved',grouping:'headers',offset:args.offset,hasMore:args.offset+20<65,items:Array.from({length:Math.min(20,65-args.offset)},(_,i)=>({id:'m'+(i+args.offset),sourceHash:'h'+(i+args.offset),subject:'합성 출시 검토 '+(i+args.offset),date:'2026-10-21'}))};
 }return {};
};
function App(){const [id,setId]=useState('m0');window.setThreadId=setId;const source={id,sourceHash:'h'+id.slice(1),local:{tags:[]},mail:{subject:'합성 출시 검토 '+id.slice(1),from:'누비 검토팀 <team@example.test>',to:'review@example.test',date:'2026-10-21',text:'검토 자료를 확인하고 후속 일정을 정리해 주세요.',attachments:[]}};
 return <main className="desktop-shell"><section className="nubi-mail-history nubi-mail-thread-fixture"><MailReader key={id} source={source} api={api} onOpenThread={(next,hash)=>{window.openedThread={id:next,hash};setId(next);}}/><input aria-label="보존 초안" defaultValue="작성 중인 메모"/></section></main>;}
createRoot(document.getElementById('root')).render(<App/>);
