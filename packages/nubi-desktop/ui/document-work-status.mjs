export function documentWorkStatuses(task){
 const rows=[],e=task?.liveEditor,n=task?.nativeOffice;
 if(e){const status=e.state==='attention'?'변경 결과 확인 필요':e.state==='executing'?'변경 적용 중':e.state==='proposed'?'변경 검토 대기':e.state==='approved'?'승인됨':e.state==='disconnected'?'연결 해제됨':e.result?.status==='verified'?'변경 확인됨':'문서 연결됨';rows.push({title:e.title||'연결한 문서',status,save:e.bufferState?.dirty===true?'저장 전':e.bufferState?.dirty===false?'편집기 미저장 변경 없음':'저장 여부 미확인',attention:e.state==='attention'});}
 if(n){rows.push({title:n.binding?.documentTitle||n.binding?.app||'Office',status:n.state==='attention'?'변경 결과 확인 필요':n.state==='executing'?'변경 적용 중':n.pending?'변경 검토 대기':n.outcome?.finished?'변경 확인됨':'Office 연결됨',save:n.saveUncertain?'저장 결과 확인 필요':n.saveReceipt?.saved===true?'저장 확인됨':'Office에서 저장 필요',attention:n.state==='attention'||n.saveUncertain});}
 return rows;
}
