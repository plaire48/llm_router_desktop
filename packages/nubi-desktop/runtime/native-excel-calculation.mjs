import {Worker} from 'node:worker_threads';
export function calculateNativeExcelDraft(sheets,{signal,timeoutMs=12000}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(Error('native_office_cancelled'));return;}
  const worker=new Worker(new URL('./native-excel-calculator-worker.mjs',import.meta.url),{workerData:{sheets},execArgv:[],stdout:true,stderr:true,resourceLimits:{maxOldGenerationSizeMb:256}});worker.stdout.resume();worker.stderr.resume();let done=false;
  const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);worker.terminate().catch(()=>{});error?reject(error):resolve(result);};
  const cancel=()=>finish(Error('native_office_cancelled')),timer=setTimeout(()=>finish(Error('native_excel_calculation_timeout')),timeoutMs);signal?.addEventListener('abort',cancel,{once:true});
  worker.once('message',m=>m.error?finish(Object.assign(Error(m.error),{detail:m.detail})):finish(null,m.result));worker.once('error',()=>finish(Error('native_excel_calculation_unavailable')));worker.once('exit',()=>finish(Error('native_excel_calculation_unavailable')));
 });
}
