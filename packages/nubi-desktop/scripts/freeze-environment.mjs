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
 const result={at:new Date().toISOString(),loadavg:os.loadavg(),cpuCount:os.cpus().length,processes:[],processError:null};
 try{
  // comm contains executable names, not command arguments or environment values.
  const {stdout}=await execute('ps',['-axo','pid=,ppid=,pcpu=,pmem=,comm='],{timeout:5000,maxBuffer:2*1024*1024});
  result.processes=parseProcessLoad(stdout);
 }catch(error){result.processError=String(error.code||'process_load_unavailable');}
 return result;
}
export function freezeExitCode(error,{results=[],errors=[],baseline=false}={}){
 const productFailed=errors.length||!baseline&&results.some(row=>row.violations.length);
 return error?.code==='environment_unstable'&&!productFailed?2:1;
}
