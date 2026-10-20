import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {appendFileSync} from 'node:fs';
import {createHostModelTransport} from '../dist/host-model.js';
import {prepareWordDocument} from '../dist/word.js';
import {prepareExcelDocument} from '../dist/excel.js';
import {preparePowerPointDocument} from '../dist/powerpoint.js';
import {evaluateWordCreate01} from './word-create-oracle.mjs';
import {evaluateExcelCreate01,evaluatePowerPointCreate01} from './office-create-oracle.mjs';
const configs={word:{prefix:'WD',extension:'docx',prepare:prepareWordDocument,evaluate:evaluateWordCreate01},excel:{prefix:'EX',extension:'xlsx',prepare:prepareExcelDocument,evaluate:evaluateExcelCreate01},powerpoint:{prefix:'PP',extension:'pptx',prepare:preparePowerPointDocument,evaluate:evaluatePowerPointCreate01}};
const classified=new Set(['claude_login_required','no_credential','rate_limited','cancelled','worker_disconnected','invalid_model','host_model_failed','host_model_response_invalid','operation_cancelled','model_failed','word_draft_missing','excel_draft_missing','powerpoint_draft_missing']);
const blocked=new Set(['claude_login_required','no_credential','rate_limited','worker_disconnected','invalid_model']);
const errorCode=error=>classified.has(error?.code)?error.code:classified.has(error?.message)?error.message:'evaluation_failed';
/** Evaluation-only: fixed denominator, preserved attempts, no reference drafts or auth stores are read. */
export async function runHostAuthoringEvaluation({host,output,domains=['word','excel','powerpoint'],trials=3,qualityRepairs=1,evidence='fixture',signal,onProgress=()=>{},verifyArtifact}){
  if(!domains.length||new Set(domains).size!==domains.length||domains.some(d=>!configs[d])||!Number.isInteger(trials)||trials<1||trials>3||![0,1].includes(qualityRepairs)||!['fixture','live'].includes(evidence))throw Error('evaluation_options_invalid');
  await mkdir(output,{recursive:true});
  const reportPath=join(output,'results.json');try{await stat(reportPath);throw Error('evaluation_output_exists');}catch(error){if(error.code!=='ENOENT')throw error;}
  const report={schemaVersion:1,kind:'host_model_document_authoring',startedAt:new Date().toISOString(),evidence,modelId:host.id,modelMeasured:false,plannedTrials:domains.length*trials,initialPassed:0,finalPassed:0,actualOffice2016:false,nascaVerified:false,workspaceIntegrated:false,manualVisualReviewRequired:true,trials:[],sourceHashes:{}};
  for(let index=1;index<=trials;index++)for(const domain of domains)report.trials.push({domain,index,status:'not_run',attempts:[]});
  for(const file of ['src/host-model.ts','src/word.ts','src/excel.ts','src/powerpoint.ts','src/draft-planning.ts','src/excel-formula.ts','src/generated-package.ts','src/word-draft.schema.json','src/excel-draft.schema.json','src/powerpoint-draft.schema.json','eval/host-authoring.mjs','eval/word-create-oracle.mjs','eval/office-create-oracle.mjs','scripts/qa-host-artifact.py'])report.sourceHashes[file]=createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex');
  const persist=()=>writeFile(reportPath,JSON.stringify(report,null,2)+'\n');await persist();let stopReason;
  for(const trial of report.trials){
    if(stopReason||signal?.aborted){trial.reason=stopReason??'operation_cancelled';continue;}
    const config=configs[trial.domain],task=JSON.parse(await readFile(new URL(`./${config.prefix}-CREATE-01.json`,import.meta.url),'utf8'));
    trial.taskId=task.id;trial.taskSha256=createHash('sha256').update(JSON.stringify(task)).digest('hex');trial.status='running';
    let feedback='';
    for(let attempt=0;attempt<=qualityRepairs;attempt++){
      const row={attempt,stage:attempt?'repair':'initial',metrics:[],tools:[],status:'running'},controller=new AbortController();
      trial.attempts.push(row);const started=performance.now();const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
      const timer=setTimeout(()=>{row.budgetExceeded=true;controller.abort();},240_000);
      const transport=createHostModelTransport(host,{onMetric:event=>{row.metrics.push(event);const metric={domain:trial.domain,index:trial.index,attempt,...event};appendFileSync(join(output,'metrics.jsonl'),JSON.stringify(metric)+'\n');try{onProgress(metric);}catch{}}});
      await persist();
      try{
        const result=await config.prepare({request:task.request+(feedback?'\n\n검사 피드백: '+feedback+'\n원래 요구와 자료를 유지하며 문제를 수정한 전체 구조 초안을 다시 제출하세요.':''),sources:task.sources},transport,controller.signal,{fontFamily:process.platform==='darwin'?'Apple SD Gothic Neo':'Malgun Gothic',onTool:name=>row.tools.push(name)});
        const relative=`${trial.domain}-${trial.index}/attempt-${attempt}`;await mkdir(join(output,relative),{recursive:true});
        row.artifact=`${relative}/draft.${config.extension}`;await writeFile(join(output,row.artifact),result.bytes,{flag:'wx'});await writeFile(join(output,relative,'draft.json'),JSON.stringify(result.draft,null,2)+'\n',{flag:'wx'});
        row.sha256=createHash('sha256').update(result.bytes).digest('hex');row.evaluation=await config.evaluate(result.bytes);
        if(verifyArtifact)row.runtime=await verifyArtifact({domain:trial.domain,path:join(output,row.artifact),directory:join(output,relative,'qa'),draft:result.draft,signal:controller.signal});
        row.status=row.evaluation.passed&&(!row.runtime||row.runtime.passed)?'automated_pass':'quality_failed';
        row.failedChecks=[...(row.evaluation.failed??Object.entries(row.evaluation.checks??{}).filter(([,value])=>!value).map(([key])=>key)),...(row.runtime?.failed??[])];
        feedback=JSON.stringify({failed:row.failedChecks,renderedPages:row.runtime?.pageCount??null});
      }catch(error){
        row.error=row.metrics.findLast(m=>m.kind==='model_end'&&m.error)?.error??errorCode(error);row.status='failed';feedback=row.error;if(blocked.has(row.error))stopReason=row.error;
      }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);row.elapsedMs=Math.round(performance.now()-started);await persist();}
      try{onProgress({domain:trial.domain,index:trial.index,attempt,status:row.status,failed:row.failedChecks,error:row.error,elapsedMs:row.elapsedMs});}catch{}
      if(row.status==='automated_pass'||stopReason||signal?.aborted||row.error==='operation_cancelled'||row.error==='host_model_failed')break;
    }
    trial.status=trial.attempts.at(-1).status;await persist();
  }
  report.initialPassed=report.trials.filter(t=>t.attempts[0]?.status==='automated_pass').length;
  report.finalPassed=report.trials.filter(t=>t.status==='automated_pass').length;
  report.completedTrials=report.trials.filter(t=>t.status!=='not_run').length;
  report.modelResponses=report.trials.flatMap(t=>t.attempts).flatMap(a=>a.metrics).filter(m=>m.kind==='model_end'&&!m.error).length;
  report.modelMeasured=evidence==='live'&&report.modelResponses>0;
  report.finishedAt=new Date().toISOString();await persist();return report;
}
