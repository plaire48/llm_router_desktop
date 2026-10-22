export const FREEZE_SCENES=Object.freeze([
 {id:'chat',name:'500개 대화와 스트리밍 입력',durationMs:6000},
 {id:'wiki',name:'위키 150노드와 문서',durationMs:6000},
 {id:'mail',name:'메일 1000건과 필터',durationMs:6000},
 {id:'workflow',name:'1000단계 60초 폴링',durationMs:60000},
 {id:'terminal',name:'5000줄 출력 스트리밍',durationMs:6000},
 {id:'navigation',name:'화면 10회와 프로젝트 전환',durationMs:10000}
]);
const p95=values=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]:null;
export function displayInterval(frames){
 if(!frames.length||frames.some(n=>!Number.isFinite(n)||n<=0))return null;
 const sorted=[...frames].sort((a,b)=>a-b),middle=sorted.length>>>1;
 return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
}
export function freezeMetrics({tasks=[],frames=[],inputs=[],heapBytes=null,startupDelayMs=null,displayIntervalMs=null}={}){
 const valid=Number.isFinite(displayIntervalMs)&&displayIntervalMs>0,frameP95Ms=p95(frames);
 let consecutive=0,maxConsecutiveMissedFrames=0;
 if(valid)for(const interval of frames){consecutive=interval-1.5*displayIntervalMs>1e-9?consecutive+1:0;maxConsecutiveMissedFrames=Math.max(maxConsecutiveMissedFrames,consecutive);}
 const missedFrames=valid?frames.filter(n=>n-1.5*displayIntervalMs>1e-9).length:null;
 return {longTasks:tasks.filter(t=>t.duration>50).length,freezes:tasks.filter(t=>t.duration>200).length,maxTaskMs:Math.max(0,...tasks.map(t=>t.duration)),frameP95Ms,frameMaxMs:frames.length?Math.max(...frames):null,displayIntervalMs,maxConsecutiveMissedFrames,frameP95Ratio:valid&&frameP95Ms!==null?frameP95Ms/displayIntervalMs:null,missedFrames,missedFrameRatio:valid&&frames.length?missedFrames/frames.length:null,inputLimitMs:valid?Math.max(50,2*displayIntervalMs+10):null,inputMaxMs:inputs.length?Math.max(...inputs):null,heapBytes,startupDelayMs,frameSamples:frames.length,inputSamples:inputs.length,tasks,frames,inputs};
}
export function freezeViolations(result,{judgeFrames=true}={}){
 const failures=[];
 if(result.startupDelayMs!==null&&(!Number.isFinite(result.startupDelayMs)||result.startupDelayMs<0))failures.push('samples_invalid');
 if(result.startupDelayMs>200)failures.push('startup_freeze');
 if(result.frames.some(x=>!Number.isFinite(x)||x<=0)||result.inputs.some(x=>!Number.isFinite(x)||x<0)||result.tasks.some(x=>!Number.isFinite(x.duration)||x.duration<0))failures.push('samples_invalid');
 if(result.longTasks)failures.push('long_tasks');if(result.freezes)failures.push('freezes');
 if(!Number.isFinite(result.displayIntervalMs)||result.displayIntervalMs<=0)failures.push('display_interval_missing');
 if(judgeFrames&&result.missedFrameRatio!==null&&result.missedFrameRatio>.01)failures.push('missed_frames');
 if(judgeFrames&&result.maxConsecutiveMissedFrames>=3)failures.push('consecutive_missed_frames');
 if(judgeFrames&&result.frameMaxMs!==null&&result.frameMaxMs>100)failures.push('frame_max');
 if(result.inputMaxMs!==null&&result.inputLimitMs!==null&&result.inputMaxMs>result.inputLimitMs)failures.push('input_delay');
 if(result.frameSamples>0&&result.frameSamples<600)failures.push('samples_insufficient');
 if(!result.frameSamples||!result.inputSamples)failures.push('samples_missing');return failures;
}

// Contract failures are collected with timing failures so a slow admission
// cannot abort the remaining scenes or discard their raw measurements.
export function conversationAdmissionViolations(rows){
 if(!rows?.length)return ['admission_samples_missing'];
 const failures=[];
 if(rows[0].count!==4)failures.push('admission_first_rows');
 if(rows.at(-1).count!==40)failures.push('admission_incomplete');
 if(rows.some((row,index)=>!Number.isFinite(row.at)||index&&row.at<rows[index-1].at))failures.push('admission_samples_invalid');
 if(rows.at(-1).at-rows[0].at>300)failures.push('admission_deadline');
 if(rows.some((row,index)=>index&&row.count-rows[index-1].count>4))failures.push('admission_batch');
 return failures;
}
// Condition A (design 2026-10-22 §6): Chrome flags (e.g. --disable-gpu) and CPU throttling are opt-in; defaults are today's run.
export function freezeRunOptions(env=process.env){
 const chromeArgs=(env.FREEZE_CHROME_ARGS||'').split(/\s+/).filter(Boolean);
 const raw=env.FREEZE_CPU_THROTTLE??'1';if(!/^[1-9]\d*$/.test(raw))throw Error('freeze_throttle_invalid');
 return {chromeArgs,cpuThrottle:Number(raw)};
}
// Style recalculation cost, the measured cause of the 1.3.0 frame drops (design §1.1).
export function styleRecalcStats(events){
 const durations=events.filter(e=>e.ph==='X'&&e.name==='UpdateLayoutTree'&&e.dur>=0).map(e=>e.dur/1000);
 const round=n=>Math.round(n*10)/10;
 return {styleRecalcCount:durations.length,styleRecalcMaxMs:round(Math.max(0,...durations)),styleRecalcTotalMs:round(durations.reduce((a,b)=>a+b,0))};
}
