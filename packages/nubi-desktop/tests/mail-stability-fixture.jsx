import React,{useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {MailHistory} from '../ui/MailHistory.jsx';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
let generation=1,identity=1;
let rows=Array.from({length:65},(_,i)=>({id:'mail-'+i,sourceId:'mail-'+i,sourceHash:'a'.repeat(64),title:`업무 메일 ${i+1}`,subject:`업무 메일 ${i+1}`,from:'누비 <nubi@example.test>',to:'owner@example.test',date:'2026-10-15T01:00:00Z',state:'saved',text:'메일 본문입니다.\n'+('확인할 내용을 읽고 있습니다.\n'.repeat(60)),attachments:[],recipientRole:'to'}));
window.mailCalls=[];window.mailDelay=0;window.mailFail=false;
window.arrive=()=>{generation++;rows=[{...rows[0],id:'new-'+generation,sourceId:'new-'+generation,title:'새 메일 '+generation,subject:'새 메일 '+generation},...rows];};
window.switchAccount=()=>{identity++;generation++;rows=[{...rows[0],id:'account-'+identity,sourceId:'account-'+identity,title:'다른 계정 메일',subject:'다른 계정 메일'}];};
async function api(method,args={}){
 window.mailCalls.push({method,...args});
 if(method!=='mail')throw Error('unexpected_api');
 if(args.action==='status')return {connected:true,accountKey:String(identity),identityRevision:0,progress:{lastAppliedAt:String(generation)},counts:{received:rows.length},folders:[]};
 if(args.action==='history')return {total:rows.length,messages:structuredClone(rows)};
 if(args.action==='facets')return {tags:[],senders:[]};
 if(args.action==='portalSync')return {connected:true,accountKey:String(identity),identityRevision:0,progress:{lastAppliedAt:String(generation)}};
 if(args.action==='read'){const row=rows.find(r=>r.id===args.id);return {id:row.id,sourceHash:row.sourceHash,mail:structuredClone(row),local:{tags:[],pinned:false}};}
 if(args.action==='search'){
  await new Promise(r=>setTimeout(r,window.mailDelay));if(window.mailFail)throw Error('offline');
  const matches=rows.filter(r=>!args.query||r.title.includes(args.query));
  const reset=!!args.cursor&&!args.cursor.startsWith(generation+':');
  const totalPages=Math.ceil(matches.length/args.limit),page=reset?1:Math.min(args.page||1,Math.max(1,totalPages)),offset=(page-1)*args.limit;
  return {results:structuredClone(matches.slice(offset,offset+args.limit)),page,offset,total:matches.length,totalPages,currentCursor:generation+':'+page,reset,unavailable:[]};
 }
 if(args.action==='updateLocal')return args.patch;
 throw Error('unexpected_action');
}
function App(){const state=useRef({});return <main className="desktop-shell" style={{height:'100vh',padding:24}}><MailHistory api={api} viewState={state} onSettings={()=>{}} onAsk={items=>{window.asked=items;}}/></main>;}
createRoot(document.getElementById('root')).render(<App/>);
