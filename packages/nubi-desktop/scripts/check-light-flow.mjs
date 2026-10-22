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
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const env={...process.env,FREEZE_CHROME_ARGS:'--disable-gpu',FREEZE_CPU_THROTTLE:'4',FREEZE_TRACE:'1',FREEZE_TAG:process.env.FREEZE_TAG||'light-flow'};
 const rows=[];let buffer='';
 const code=await new Promise(resolve=>{const child=spawn(process.execPath,['scripts/check-freeze-scenes.mjs'],{env,stdio:['ignore','pipe','inherit']});
  child.stdout.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(line.startsWith('{"scene"')){try{rows.push(JSON.parse(line));}catch{}}}});
  child.on('exit',resolve);});
 const verdict=judgeLightFlow(rows);
 console.log(JSON.stringify({check:'light-flow',freezeExit:code,rows:rows.map(r=>r.skipped?{scene:r.scene,width:r.width,skipped:r.skipped}:{scene:r.scene,width:r.width,longTasks:r.longTasks,missedFrameRatio:r.missedFrameRatio,frameP95Ms:r.frameP95Ms,frameMaxMs:r.frameMaxMs,styleRecalcMaxMs:r.styleRecalcMaxMs,styleRecalcTotalMs:r.styleRecalcTotalMs}),...verdict}));
 process.exitCode=verdict.pass?0:1;
}
