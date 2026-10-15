const actionLabels={proposed:'승인 대기',starting:'실행 준비 중',started:'실행 요청됨',rejected:'실행하지 않음',stale:'근거 변경됨',attention:'실행 상태 확인 필요'};
export const processLabels={checking:'실행 전 확인',running:'실행 중',stopping:'중지 중',completed:'명령 종료',failed:'실행 실패',cancelled:'중지됨',timed_out:'시간 초과',interrupted:'중단됨'};
const recoveryLabels={queued:'결과 확인 대기',diagnosing:'결과 확인 중',review:'결과 확인됨',paused:'결과 확인 중단',waiting_input:'확인 필요',cancelled:'중지됨'};
export function commandRecordStatus(action,process){
 if(action.error==='shell_not_selected')return '기본 터미널 변경됨';
 if(action.state!=='started'||!process)return actionLabels[action.state];
 // An independent review does not turn a failed/cancelled execution into success.
 if(['failed','cancelled','timed_out','interrupted','checking','running','stopping'].includes(process.state))return processLabels[process.state];
 if(Number.isInteger(process.exitCode)&&process.exitCode!==0)return '실행 실패';
 return recoveryLabels[process.recoveryState]||processLabels[process.state]||'실행 상태 확인 필요';
}
