import React from 'react';
import {createRoot} from 'react-dom/client';
import {ApprovalHistory} from '../ui/ApprovalHistory.jsx';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../design/workspace-typography.css';
import '../design/workspace-dialogs.css';
window.approvalFailure='mail_portal_approval_request';window.failureStage='list';window.failureStatus=415;window.documentFailure=null;window.loginClicks=0;window.approvalCalls=[];
function fail(code,stage){throw Object.assign(Error(code),{approvalFailure:{code,stage:window.failureStage||stage,httpStatus:window.failureStatus}});}
const api=async(_method,args)=>{
 window.approvalCalls.push(args);
 if(args.action==='approvals'){if(window.approvalFailure)fail(window.approvalFailure,'list');return {page:args.page,total:2,hasNext:args.page===1,items:[{id:'item'+args.page,lineId:'line',subject:'검토용 결재 문서 '+args.page,submittedAt:'2026-10-16T01:00:00Z'}]};}
 if(args.action==='approvalRead'){if(window.documentFailure)fail(window.documentFailure,'document');return {id:args.id,lineId:args.lineId,subject:'결재 본문',mail:{text:'확인할 결재 내용'}};}
 return {};
};
createRoot(document.getElementById('root')).render(<main style={{padding:24,maxWidth:900,margin:'auto'}}><ApprovalHistory api={api} status={{connected:true}} onSettings={()=>window.loginClicks++}/></main>);
