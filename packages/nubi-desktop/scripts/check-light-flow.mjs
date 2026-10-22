// Light-flow verdict on condition A (design 2026-10-22-nubi-desktop-light-flow §6): local Chrome with the GPU off and a
// 4x slower CPU, the freeze scenes with style tracing. Judged locally; a shared runner records without judging (§8 답 15).
import {spawn} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export const LIGHT_FLOW_TARGETS=Object.freeze({chatMissedFrameRatio:0.05,longTasks:5,styleRecalcMaxMs:16});
export function judgeLightFlow(rows,{env=process.env}={}){
 const measured=rows.filter(row=>!row.skipped);
 if(env.NUBI_SHARED_RUNNER==='1')return {pass:true,failures:[],unjudged:true};
 if(!measured.length)return {pass:false,failures:['no measured scene']};
 const failures=[];
 for(const row of measured){const at=row.scene+':'+row.width;
  if(row.scene==='chat'&&row.missedFrameRatio>LIGHT_FLOW_TARGETS.chatMissedFrameRatio)failures.push(`${at} missed frames ${Math.round(row.missedFrameRatio*1000)/10}% > 5%`);
  if(row.longTasks>LIGHT_FLOW_TARGETS.longTasks)failures.push(`${at} long tasks ${row.longTasks} > 5`);
  if(row.styleRecalcMaxMs>LIGHT_FLOW_TARGETS.styleRecalcMaxMs)failures.push(`${at} style recalculation ${row.styleRecalcMaxMs}ms > 16ms`);}
 return {pass:failures.length===0,failures};
}
// Several runs judged on the median of each scene and width; a scene that did not report fails (plan 2a).
export function judgeLightFlowRuns(runs,{env=process.env,expected=[]}={}){
 if(env.NUBI_SHARED_RUNNER==='1')return {pass:true,failures:[],unjudged:true};
 const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};
 const groups=new Map();
 for(const run of runs)for(const row of run){if(row.skipped)continue;const key=row.scene+':'+row.width;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 const medians=[...groups.entries()].map(([key,rows])=>({scene:rows[0].scene,width:rows[0].width,missedFrameRatio:median(rows.map(r=>r.missedFrameRatio)),longTasks:median(rows.map(r=>r.longTasks)),styleRecalcMaxMs:median(rows.map(r=>r.styleRecalcMaxMs))}));
 const verdict=judgeLightFlow(medians,{env});const missing=expected.filter(key=>!groups.has(key)).map(key=>key+' missing');
 const failures=[...missing,...verdict.failures];
 return {pass:failures.length===0,failures,medians};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const env={...process.env,FREEZE_CHROME_ARGS:'--disable-gpu',FREEZE_CPU_THROTTLE:'4',FREEZE_TRACE:'1',FREEZE_TAG:process.env.FREEZE_TAG||'light-flow'};
 const runCount=Number(process.argv[process.argv.indexOf('--runs')+1])||3,runs=[],codes=[];
 const {FREEZE_SCENES}=await import('./freeze-metrics.mjs');const {DESKTOP_FEATURES}=await import('../runtime/beta-features.mjs');
 const expected=FREEZE_SCENES.filter(scene=>scene.id!=='workflow'||DESKTOP_FEATURES.workflows).flatMap(scene=>[1280,440].map(width=>scene.id+':'+width));
 for(let run=0;run<runCount;run++){
 const rows=[];let buffer='';
 const code=await new Promise(resolve=>{const child=spawn(process.execPath,['scripts/check-freeze-scenes.mjs'],{env,stdio:['ignore','pipe','inherit']});
  child.stdout.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(line.startsWith('{"scene"')){try{rows.push(JSON.parse(line));}catch{}}}});
  child.on('exit',resolve);});
  runs.push(rows);codes.push(code);
 }
 const rows=runs.flat();const verdict=judgeLightFlowRuns(runs,{expected});const code=codes;
 console.log(JSON.stringify({check:'light-flow',freezeExit:code,rows:rows.map(r=>r.skipped?{scene:r.scene,width:r.width,skipped:r.skipped}:{scene:r.scene,width:r.width,longTasks:r.longTasks,missedFrameRatio:r.missedFrameRatio,frameP95Ms:r.frameP95Ms,frameMaxMs:r.frameMaxMs,styleRecalcMaxMs:r.styleRecalcMaxMs,styleRecalcTotalMs:r.styleRecalcTotalMs}),...verdict}));
 process.exitCode=verdict.pass?0:1;
}
