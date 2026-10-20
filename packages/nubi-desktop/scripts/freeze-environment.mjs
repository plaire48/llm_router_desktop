import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {displayInterval,freezeMetrics} from './freeze-metrics.mjs';
const execute=promisify(execFile);
// This preflight classifies the empty shell only. It never corrects scene data.
export function calibrationState(frames){
 const d=displayInterval(frames);
 if(!(d>0))throw Error('calibration_invalid');
 const metrics=freezeMetrics({frames,displayIntervalMs:d});
 return {status:metrics.missedFrameRatio>.01?'environment_unstable':'ready',metrics};
}
export function parseProcessLoad(output){
 return output.split('\n').flatMap(line=>{
  const match=line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+?)\s*$/);
  if(!match)return [];
  return [{pid:Number(match[1]),parentPid:Number(match[2]),cpuPercent:Number(match[3]),memoryPercent:Number(match[4]),command:match[5]}];
 }).sort((a,b)=>b.cpuPercent-a.cpuPercent||a.pid-b.pid).slice(0,10);
}
export async function captureSystemLoad(){
 const supported=os.platform()!=='win32';
 const result={at:new Date().toISOString(),loadavg:os.loadavg(),loadavgStatus:supported?'available':'unsupported',cpuCount:os.cpus().length,processes:[],processError:supported?null:'process_load_unsupported'};
 if(!supported)return result;
 try{
  // comm contains executable names, not command arguments or environment values.
  const {stdout}=await execute('ps',['-axo','pid=,ppid=,pcpu=,pmem=,comm='],{timeout:5000,maxBuffer:2*1024*1024});
  result.processes=parseProcessLoad(stdout);
 }catch(error){result.processError=String(error.code||'process_load_unavailable');}
 return result;
}
export const SCENE_LOAD_LIMIT=4;
export function sceneEnvironmentState(samples=[]){
 const usable=samples.filter(s=>s.status!=='unavailable'&&s.loadavgStatus==='available'&&Array.isArray(s.loadavg)&&s.loadavg.length===3&&s.loadavg.every(Number.isFinite));
 const excessive=usable.filter(s=>s.loadavg[0]>SCENE_LOAD_LIMIT),peak=usable.length?Math.max(...usable.map(s=>s.loadavg[0])):null;
 return {status:excessive.length?'environment_unstable':usable.length?'ready':'unavailable',reasons:excessive.length?[{code:'loadavg_exceeded',threshold:SCENE_LOAD_LIMIT,firstExceededAt:excessive[0].at,peakLoadavg:peak}]:[]};
}
// Control-process diagnostics only: no renderer subprocesses, no overlapping ps,
// no retries or invented zeroes. A delayed capture remains an explicit sample.
export function createSceneLoadSampler({capture=captureSystemLoad,intervalMs=1000,context={}}={}){
 const samples=[];let timer,pending,stopped=false,ending;const epoch=performance.now();
 const collect=async stage=>{const start=performance.now();let value;try{value={status:'available',...await capture()};}catch(error){value={status:'unavailable',error:String(error.code||'collector_failed')};}const captureMs=performance.now()-start;samples.push({...value,...context,stage,at:value.at||new Date().toISOString(),elapsedMs:start-epoch,captureMs,delayed:captureMs>intervalMs});};
 const schedule=()=>{if(!stopped)timer=setTimeout(()=>{pending=collect('during');pending.finally(schedule);},intervalMs);};
 return {async start(){if(pending||stopped)return;pending=collect('scene-start');await pending;schedule();},stop(){if(!ending)ending=(async()=>{stopped=true;clearTimeout(timer);await pending;await collect('scene-end');return samples;})();return ending;}};
}
const timingFailures=new Set(['long_tasks','freezes','startup_freeze','missed_frames','consecutive_missed_frames','frame_max','input_delay']);
export function classifyFreezeResults({results=[],errors=[],baseline=false}={}){
 if(errors.length||results.some(r=>r.pageErrors?.length))return 1;
 const noisy=row=>row.environmentReasons?.some(r=>r.code==='loadavg_exceeded');
 // Scene load above SCENE_LOAD_LIMIT excuses timing violations (unjudged, exit 2).
 // It never voids a clean scene: load can only hurt, and each scene keeps its
 // functional assertions and frame minimum (design §8 answer 15, 2026-10-20).
 let unjudged=false;
 for(const row of results){const violations=row.violations||[];if(violations.some(v=>!timingFailures.has(v)))return 1;if(!violations.length)continue;if(noisy(row))unjudged=true;else if(!baseline)return 1;}
 return unjudged?2:0;
}
export function freezeExitCode(error,{results=[],errors=[],baseline=false}={}){
 const outcome=classifyFreezeResults({results,errors,baseline});
 return error?.code==='environment_unstable'&&outcome!==1?2:1;
}
