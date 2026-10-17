import React,{useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {TerminalBlock} from './TerminalBlock.jsx';
import {ApprovalBar} from './ApprovalBar.jsx';
import {DecisionPrompt} from './DecisionPrompt.jsx';
import {TerminalMark} from './marks.jsx';
import {commandRecordStatus,processLabels} from './command-record-status.mjs';

const active=process=>['checking','running','stopping'].includes(process?.state);
// An approved command reads like its shell, in the turn it was approved in: the command, the output as it arrives and
// the actual state, exit code and stop control in the receipt (user decisions 2026-09-30 and 2026-10-14: no "실행 결과 보기",
// nothing moved to the bottom). Records start folded; expanding reads the saved command and output.
function CommandRecord({action,process,state,profiles,onOpenTerminal,onStop}){
 const [expanded,setExpanded]=useState(false);
 const shell=profiles.find(item=>item.id===(process?.profile||action.profile))?.label||process?.profile||action.profile;
 return <details className="nubi-process-fold nubi-command-record" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
  <summary><TerminalMark size={16}/><strong title={action.title}>{action.title}</strong>{active(process)&&<span className="status-spinner" aria-hidden="true"/>}<small role="status">{state}</small><Icon name="chevronDown" size={14}/></summary>
  {expanded&&<div className="nubi-command-record-body">
   <TerminalBlock inputText={action.kind==='input'} profile={shell} workspace={process?.cwd||action.workspace} command={action.kind==='input'?JSON.stringify(action.script):process?.script||action.script} label={action.kind==='input'?'보낸 입력과 프로그램 출력':process?'실행한 명령과 결과':'명령 기록'} copyOutput={!!process?.output}
    output={process?(process.fault==='shell_command_limit'?'명령이 너무 길어요. 짧은 명령으로 나누거나 다른 셸을 선택해 주세요.':process.output||(active(process)?'출력을 기다리고 있어요.':'출력이 없었어요.')):undefined}
    status={process?<><span className="nubi-terminal-state" data-state={process.state}>{processLabels[process.state]||process.state}</span>{process.exitCode!==null&&process.exitCode!==undefined&&<span className="nubi-terminal-exit" title="종료 코드">exit {process.exitCode}</span>}{process.state==='running'&&onStop&&<CxButton className="nubi-terminal-stop" aria-label="명령 중지" title="명령 중지" onClick={()=>onStop(process)}><span className="stop-symbol" aria-hidden="true"/></CxButton>}</>:action.state==='rejected'?'실행하지 않았어요.':'실행 기록이 없습니다.'}/>
   {onOpenTerminal&&action.resultProcessId&&<div className="nubi-command-record-actions"><CxButton onClick={()=>onOpenTerminal({cwd:process?.cwd||action.workspace,contextId:action.id,processId:action.resultProcessId})}><TerminalMark size={16}/>터미널 열기</CxButton></div>}
  </div>}
 </details>;
}
// Expanding reads the existing command/result only; it never starts a process.
export function SetupActions({actions,proposals=[],processes=[],latest=null,profiles=[],disabled,onDecision,onAlways,onStop,onOpenTerminal}) {
 return actions.map(action=>{
  const input=action.kind==='input',admin=action.privilege==='administrator',waiting=(action.afterProposals||[]).some(id=>proposals.some(p=>p.id===id&&p.state==='proposed'));
  const process=action.resultProcessId?[latest,...processes].find(item=>item?.id===action.resultProcessId)||null:null,pending=action.state==='proposed';
  const state=commandRecordStatus(action,process);
  return <section key={action.id} className="nubi-setup-summary" aria-label="실행 준비 승인">
   {pending?<DecisionPrompt inline id={action.id} title={input?'실행 중인 프로그램에 입력할까요?':'이 명령을 실행할까요?'} summary={action.title} icon="terminal" blocked={disabled||waiting}>
    <p className="nubi-decision-reason">{action.reason}</p>
    {input&&<TerminalBlock profile={action.profile} workspace={action.inputTarget?.cwd} command={action.inputTarget?.command} label="입력받을 프로그램"/>}
    <TerminalBlock inputText={input} profile={action.profile} workspace={action.workspace} command={input?JSON.stringify(action.script):action.script} label={input?'보낼 입력':'실행할 명령'}/>
    <p className="nubi-action-effect"><strong>예상 변경</strong> {action.effects}</p>
    {admin?<p className="nubi-action-warning"><Icon name="alertCircle" size={18}/><span><strong>관리자 권한 필요</strong> {action.privilegeReason} 승인 후 Windows UAC에서 확인해 주세요. 이미 시작한 작업은 중지를 보장할 수 없습니다.</span></p>:<p className="nubi-decision-scope">{input?'현재 질문에 이 입력을 한 번 보냅니다. 출력이 바뀌면 다시 확인합니다.':'현재 사용자 권한으로 실행하며 명령에 따라 프로젝트 밖에도 영향을 줄 수 있습니다.'}</p>}
    <ApprovalBar approveLabel={input?'입력 승인':admin?'관리자 실행 승인':'실행 승인'} rejectLabel="취소" disabled={disabled} approveDisabled={waiting} onApprove={()=>onDecision(action,'approve')} onReject={()=>onDecision(action,'reject')} onAlways={!input&&!admin&&onAlways?()=>onAlways(action):undefined}/>
   </DecisionPrompt>:<CommandRecord action={action} process={process} state={state} profiles={profiles} onOpenTerminal={onOpenTerminal} onStop={onStop}/>}

   {waiting&&pending&&<p className="nubi-muted">수정안을 반영하면 실행할 수 있어요.</p>}
   {!pending&&['stale','attention'].includes(action.state)&&<p className="nubi-muted">{action.error?.startsWith('process_input_')?'프로그램 상태나 출력이 바뀌었어요. 현재 질문을 다시 확인해 주세요.':action.error==='shell_not_selected'?'실행하지 않았어요. 선택한 터미널에 맞는 명령을 다시 준비해 주세요.':action.state==='stale'?'근거 파일이 바뀌었어요. 현재 내용으로 새 제안을 준비해 주세요.':'이전 실행 기록을 확인해 주세요. 같은 명령을 자동으로 반복하지 않습니다.'}</p>}
  </section>;
 });
}
