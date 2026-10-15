import React from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {TerminalBlock} from './TerminalBlock.jsx';
import {ApprovalBar} from './ApprovalBar.jsx';
import {DecisionPrompt} from './DecisionPrompt.jsx';

const labels={proposed:'승인 대기',starting:'실행 준비 중',started:'실행 요청됨',rejected:'실행하지 않음',stale:'근거 변경됨',attention:'실행 상태 확인 필요'};
const processLabels={checking:'실행 전 확인',running:'실행 중',stopping:'중지 중',completed:'명령 종료',failed:'실행 실패',cancelled:'중지됨',timed_out:'시간 초과',interrupted:'중단됨'};
const recoveryLabels={queued:'결과 확인 대기',diagnosing:'결과 확인 중',review:'결과 확인됨',paused:'결과 확인 중단',waiting_input:'확인 필요',cancelled:'중지됨'};
const active=process=>['checking','running','stopping'].includes(process?.state);
// An approved command reads like its shell, in the turn it was approved in: the command, the output as it arrives and
// the actual state, exit code and stop control in the receipt (user request 2026-10-14: no "실행 결과 보기", nothing
// moved to the bottom). The output comes from the host's process record; `latest` is the one polled most often.
export function SetupActions({actions,proposals=[],processes=[],latest=null,profiles=[],disabled,onDecision,onAlways,onStop,onOpenTerminal}) {
 return actions.map(action=>{
  const admin=action.privilege==='administrator',waiting=(action.afterProposals||[]).some(id=>proposals.some(p=>p.id===id&&p.state==='proposed'));
  const process=action.resultProcessId?[latest,...processes].find(item=>item?.id===action.resultProcessId)||null:null,pending=action.state==='proposed';
  const state=action.error==='shell_not_selected'?'기본 터미널 변경됨':action.state==='started'&&process?recoveryLabels[process.recoveryState]||processLabels[process.state]:labels[action.state];
  const shell=profiles.find(p=>p.id===action.profile)?.label||action.profile;
  return <section key={action.id} className="nubi-setup-summary" aria-label="실행 준비 승인">
   {pending?<DecisionPrompt inline id={action.id} title="이 명령을 실행할까요?" summary={action.title} icon="terminal" blocked={disabled||waiting}>
    <p className="nubi-decision-reason">{action.reason}</p>
    <TerminalBlock profile={action.profile} workspace={action.workspace} command={action.script} label="실행할 명령"/>
    <p className="nubi-action-effect"><strong>예상 변경</strong> {action.effects}</p>
    {admin?<p className="nubi-action-warning"><Icon name="alertCircle" size={18}/><span><strong>관리자 권한 필요</strong> {action.privilegeReason} 승인 후 Windows UAC에서 확인해 주세요. 이미 시작한 작업은 중지를 보장할 수 없습니다.</span></p>:<p className="nubi-decision-scope">현재 사용자 권한으로 실행하며 명령에 따라 프로젝트 밖에도 영향을 줄 수 있습니다.</p>}
    <ApprovalBar approveLabel={admin?'관리자 실행 승인':'실행 승인'} rejectLabel="취소" disabled={disabled} approveDisabled={waiting} onApprove={()=>onDecision(action,'approve')} onReject={()=>onDecision(action,'reject')} onAlways={!admin&&onAlways?()=>onAlways(action):undefined}/>
   </DecisionPrompt>:<>
    <div className="nubi-command-receipt"><Icon name="code" size={18}/><strong title={action.title}>{action.title}</strong>{active(process)&&<span className="status-spinner" aria-hidden="true"/>}<span role="status">{state}</span></div>
    <TerminalBlock profile={shell} workspace={action.workspace} command={action.script} label="명령 실행" copyOutput={!!process?.output} onOpenTerminal={onOpenTerminal?()=>onOpenTerminal({cwd:process?.cwd||action.workspace,contextId:action.id}):undefined}
     output={process?(process.fault==='shell_command_limit'?'명령이 너무 길어요. 짧은 명령으로 나누거나 다른 셸을 선택해 주세요.':process.output||(active(process)?'출력을 기다리고 있어요.':'출력이 없었어요.')):undefined}
     status={process?<><span className="nubi-terminal-state" data-state={process.state}>{processLabels[process.state]||process.state}</span>{process.exitCode!==null&&process.exitCode!==undefined&&<span className="nubi-terminal-exit" title="종료 코드">exit {process.exitCode}</span>}{process.state==='running'&&onStop&&<CxButton className="nubi-terminal-stop" aria-label="명령 중지" title="명령 중지" onClick={()=>onStop(process)}><span className="stop-symbol" aria-hidden="true"/></CxButton>}</>:undefined}/>
    {action.effects&&<p className="nubi-action-effect nubi-muted">{action.effects}</p>}
   </>}
   {waiting&&pending&&<p className="nubi-muted">수정안을 반영하면 실행할 수 있어요.</p>}
   {!pending&&['stale','attention'].includes(action.state)&&<p className="nubi-muted">{action.error==='shell_not_selected'?'실행하지 않았어요. 선택한 터미널에 맞는 명령을 다시 준비해 주세요.':action.state==='stale'?'근거 파일이 바뀌었어요. 현재 내용으로 새 제안을 준비해 주세요.':'이전 실행 기록을 확인해 주세요. 같은 명령을 자동으로 반복하지 않습니다.'}</p>}
  </section>;
 });
}
