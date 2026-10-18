import {makeQuestion} from '../../../extensions/aipro-chat/user-question.js';
import {mcpToolLabel} from './mcp-tool-labels.mjs';
import {toolArgumentView} from './tool-argument-view.mjs';
import {irreversibleMcpTool} from './irreversible-actions.mjs';
import {allowMcpTool} from './approval-policy.mjs';

// The agent and deterministic workflow use one approval card and decision rule.
export function mcpApprovalQuestion(found,args,{irreversible={},savedAllowance=false}={}){
 return {...makeQuestion(`${mcpToolLabel(found.serverId,found.tool.name)} 작업을 허용할까요?`,[],[],{choices:[{label:'실행',description:'표시된 인자로 이번 한 번 실행'},...(!irreversible.matched?[{label:'항상 허용',description:'이 프로젝트에서 이 도구 허용. 다른 도구는 별도 확인'}]:[]),{label:'취소',description:'실행하지 않음'}],inputMode:'none',selection:'single'}),toolRequest:{serverId:found.serverId,tool:found.tool.name,arguments:toolArgumentView(args),scope:irreversible.matched?'once':'project_tool',...(irreversible.matched?{irreversible:{reason:irreversible.reason},alwaysAllowIgnored:savedAllowance}:{})}};
}
export function answerMcpApproval(service,task,text){
 const pending=task.pendingMcp;if(!pending)throw Error('question_changed');
 if(!['실행','항상 허용','취소'].includes(text))throw Error('answer_invalid');
 const current=service.mcpRegistry().tool(pending.name);
 if(text==='항상 허용'&&(pending.irreversible||irreversibleMcpTool(current?.tool,{serverId:current?.serverId}).matched))throw Error('answer_invalid');
 if(text==='항상 허용')allowMcpTool(service.store,{serverId:pending.serverId,tool:pending.tool});
 task.mcpContinuation={...pending,state:text==='취소'?'cancelled':'approved'};task.pendingMcp=null;
}
