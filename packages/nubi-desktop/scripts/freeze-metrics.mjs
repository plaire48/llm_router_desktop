export const FREEZE_SCENES=Object.freeze([
 {id:'chat',name:'500개 대화와 스트리밍 입력',durationMs:6000},
 {id:'wiki',name:'위키 150노드와 문서',durationMs:6000},
 {id:'mail',name:'메일 1000건과 필터',durationMs:6000},
 {id:'workflow',name:'1000단계 60초 폴링',durationMs:60000},
 {id:'terminal',name:'5000줄 출력 스트리밍',durationMs:6000},
 {id:'navigation',name:'화면 10회와 프로젝트 전환',durationMs:10000}
]);
const p95=values=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]:null;
export function freezeMetrics({tasks=[],frames=[],inputs=[],heapBytes=null}={}){
 return {longTasks:tasks.filter(t=>t.duration>50).length,freezes:tasks.filter(t=>t.duration>200).length,maxTaskMs:Math.max(0,...tasks.map(t=>t.duration)),frameP95Ms:p95(frames),inputMaxMs:inputs.length?Math.max(...inputs):null,heapBytes,frameSamples:frames.length,inputSamples:inputs.length,tasks,frames,inputs};
}
export function freezeViolations(result){
 const failures=[];
 if(result.longTasks)failures.push('long_tasks');if(result.freezes)failures.push('freezes');
 if(result.frameP95Ms!==null&&result.frameP95Ms>16.7)failures.push('frame_p95');
 if(result.inputMaxMs!==null&&result.inputMaxMs>50)failures.push('input_delay');
 if(!result.frameSamples||!result.inputSamples)failures.push('samples_missing');return failures;
}
