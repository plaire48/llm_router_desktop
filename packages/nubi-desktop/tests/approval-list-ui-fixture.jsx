import '@e2e/cx-design-system/styles.css';
import {WikiTable,EMPTY_WIKI_FILTERS} from '../ui/WikiTable.jsx';
import {ControlledTable,TableControlsContext,TablePagination} from '../ui/ai-workspace/TableControls.jsx';
import {SortHeader} from '../ui/ai-workspace/WorkspaceLayout.jsx';
import {DocumentPreview} from '../ui/DocumentPreview.jsx';
import '../ui/wiki-browser.css';
import '../ui/ai-workspace/column-pinning.css';
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MailKnowledgeSearch} from '../ui/MailKnowledgeSearch.jsx';
import {ApprovalHistory} from '../ui/ApprovalHistory.jsx';

import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../design/workspace-typography.css';
import '../design/workspace-dialogs.css';
import '../design/workspace-icons.css';
import '../design/workspace-density.css';
const compare=new URLSearchParams(location.search).get('compare');
const performanceCase=new URLSearchParams(location.search).has('performance');
window.approvalFailure=performanceCase||compare?null:'mail_portal_approval_request';window.failureStage='list';window.failureStatus=415;window.documentFailure=null;window.loginClicks=0;window.approvalCalls=[];
function fail(code,stage){throw Object.assign(Error(code),{approvalFailure:{code,stage:window.failureStage||stage,httpStatus:window.failureStatus}});}
const api=async(_method,args)=>{
 window.approvalCalls.push(args);
 if(args.action==='facets')return {tags:[],senders:[]};
 if(args.action==='search')return {page:1,total:40,totalPages:2,offset:0,results:Array.from({length:20},(_,i)=>({sourceId:'mail'+i,sourceHash:'fixture',title:'검토용 업무 문서 '+(i+1),senderLabel:'누비',date:'2026-10-16T01:00:00Z',recipientRole:'to',attachmentCount:0}))};
 if(args.action==='approvalTitle'){await new Promise(r=>setTimeout(r,20));return {subject:'검토용 결재 문서 '+args.id};}
 if(args.action==='approvals'){if(performanceCase)return {page:1,total:60,hasNext:false,items:Array.from({length:60},(_,i)=>({id:String(i),lineId:'line',subject:'결재 문서',titlePending:true,submittedAt:'2026-10-16T01:00:00Z'}))};if(window.approvalFailure)fail(window.approvalFailure,'list');return {page:args.page,total:40,hasNext:args.page===1,items:Array.from({length:20},(_,index)=>({id:index?'other'+args.page+'-'+index:'item'+args.page,lineId:'line',subject:index?'일반 결재 '+args.page+'-'+index:'검토용 결재 문서 '+args.page,submittedAt:args.page===1?'2026-10-16T01:00:00Z':'2026-10-10T01:00:00Z',completedAt:args.page===2?'2026-10-15T01:00:00Z':null}))};}
 if(args.action==='approvalRead'){if(window.documentFailure)fail(window.documentFailure,'document');return {id:args.id,lineId:args.lineId,subject:'결재 본문',mail:{text:'확인할 결재 내용'}};}
 return {};
};
function Fixture(){const [query,setQuery]=useState(''),[,tick]=useState(0);useEffect(()=>{if(!performanceCase)return;const timer=setInterval(()=>tick(n=>n+1),50);return()=>clearInterval(timer);},[]);if(compare)return <main className="desktop-shell" style={{display:'block',height:'100vh',padding:24}}><section className="nubi-mail-history" data-layout="table" style={{maxWidth:1000,margin:'auto'}}>{['wiki','workspace','document'].includes(compare)?<OtherTable kind={compare}/>:compare==='mail'?<MailKnowledgeSearch api={api} query={query} onQuery={setQuery} onOpen={()=>{}}/>:<ApprovalHistory api={api} status={{connected:true}} onSettings={()=>{}}/>}</section></main>;return (<main style={{padding:24,maxWidth:900,margin:'auto'}}><ApprovalHistory api={api} status={{connected:true}} onSettings={()=>window.loginClicks++}/></main>);}
createRoot(document.getElementById('root')).render(<Fixture/>);

function OtherTable({kind}){
 const [sort,setSort]=useState('title-asc'),[filters,setFilters]=useState(EMPTY_WIKI_FILTERS),[widths,setWidths]=useState({}),[page,setPage]=useState(1),[selected,setSelected]=useState('');
 const rows=Array.from({length:20},(_,i)=>({path:'docs/'+i+'.md',title:'검토용 업무 문서 '+i,description:'문서의 설명입니다.',section:'overview',type:'Guide',degree:i,updatedAt:'2026-10-16T01:00:00Z'}));
 if(kind==='wiki')return <div className="nubi-wiki-browser"><div className="nubi-wiki-results"><WikiTable rows={rows} sort={sort} onSort={setSort} onOpen={setSelected} selectedPath={selected} filters={filters} facets={{sections:[{id:'overview',count:20}],types:[{id:'Guide',count:20}]}} onFilters={patch=>setFilters(value=>({...value,...patch}))}/></div></div>;
 if(kind==='document')return <DocumentPreview document={{segments:[{sheet:'Sheet 1',text:'[1,"업무","담당자"]\n[2,"품질 확인","누비"]'}]}}/>;
 const columns=[{key:'title',label:'이름',width:450},{key:'email',label:'이메일',width:240}];
 const controls={columns,widths,filters:{},options:{title:[{key:'nubi',label:'누비'}]},setWidths,setFilter:()=>{}};
 return <div className="app-shell" style={{minHeight:0,background:"var(--nubi-surface-base)"}}><TableControlsContext.Provider value={controls}><div style={{overflow:'auto',maxHeight:'clamp(180px,42vh,480px)'}}><ControlledTable className="work-list-table" stretchColumn="title"><thead><tr>{columns.map(c=><SortHeader key={c.key} field={c.key} label={c.label} sort={{key:sort,direction:'asc'}} onSort={v=>setSort(v.key)}/>)}</tr></thead><tbody>{rows.map(row=><tr key={row.path}><td><strong>{row.title}</strong></td><td>nubi@example.test</td></tr>)}</tbody></ControlledTable></div><TablePagination pagination={{page,pageCount:12,total:240,start:(page-1)*20,end:page*20,setPage}}/></TableControlsContext.Provider></div>;
}
