// Presentation follows host states; it never estimates completion or admits work.
export function projectPreparation(job){
 if(['existing','completed'].includes(job?.state))return {phase:'ready',step:2,title:job.state==='existing'?'저장된 위키를 연결했어요':'프로젝트 준비가 끝났어요'};
 if(job?.state!=='running')return {phase:'attention',step:1,title:'프로젝트 준비 상태를 확인해 주세요'};
 if(job.stage==='selecting_scope')return {phase:'scope',step:1,title:'먼저 정리할 폴더를 골라 주세요'};
 if(job.modelWaiting)return {phase:'organizing',step:1,title:'AI 응답을 기다리고 있어요'};
 if(['planning','repairing','generating','reviewing','verifying','publishing','discovering'].includes(job.stage))return {phase:'organizing',step:1,title:'읽은 자료를 위키로 정리하고 있어요'};
 return {phase:'reading',step:1,title:'프로젝트 자료를 읽고 있어요'};
}
