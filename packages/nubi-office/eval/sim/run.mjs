// Runs the real Excel worker with a model against the SIMULATED host and grades
// the final workbook state. Results are kept apart from eval/run.mjs, which
// needs real Windows Excel: nothing measured here is Excel 2016, COM, NASCA or
// Qwen evidence, and every case is synthetic.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {startAgent} from '../../worker/agent.mjs';
import {startIntentAgent} from '../../worker/intent-agent.mjs';
import {createTemplateSession} from '../../worker/template.mjs';
import {createTemplateRecord} from '../../worker/template-library.mjs';
import {safeError} from '../../worker/connection-errors.mjs';
import {driveEvaluationRun,EVALUATION_LIMITS} from '../driver.mjs';
import {scoreCase,auditChanges} from '../scoring.mjs';
import {createSimHost,hostAction} from './host.mjs';
import {recordingProviders,summarize} from './transcript.mjs';
import {forms,catalogForms,formById} from './forms.mjs';
import {installTemplates,blankWorkbook} from './catalog.mjs';
import {invokeCases} from './invoke-cases.mjs';
import {scoreMapping} from './form-scoring.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
export const SUITES=['edit','template','register','reuse','invoke'];
const LIMITATIONS=[
  'The host is simulated in JavaScript. This is not Excel 2016, COM, rendering, file saving or NASCA evidence.',
  'The model is the one named in this report. It is not the enterprise Qwen 3.8 27B baseline and says nothing about its accuracy.',
  'All cases and forms are synthetic. They do not establish accuracy on representative company templates.',
  'Formula results come from the IronCalc calculator, not from Excel.',
  'Label wording and answer quality are not graded here. needs_review outcomes require a human reviewer.'
];
const fail=code=>{throw new Error(code);};
const content=state=>({values:state.values,formulas:state.formulas,formats:state.formats,properties:state.properties});

// The fixture user answers only what the case defines. Anything else needs a person.
function simulatedUser({dialogue=[],fields=[],mapping='strict',approvals=[],proposals}){
  const answered=new Set();
  return action=>{
    if(action.name==='request_input'){
      const asked=action.payload?.text||'',candidates=dialogue.map((item,index)=>({...item,index})).filter(item=>!answered.has(item.index)&&new RegExp(item.match,'iu').test(asked));
      if(candidates.length!==1)return;
      answered.add(candidates[0].index);return{text:candidates[0].answer};
    }
    if(action.name!=='request_approval')return;
    const kind=action.payload?.kind;
    if(kind==='template_mapping'){
      proposals.push(structuredClone(action.payload.fields||[]));
      // Registration records whatever is proposed and grades it afterwards.
      return mapping==='always'||scoreMapping(action.payload.fields,fields).strict?{approved:true}:undefined;
    }
    if(approvals.includes(kind))return{approved:true};
  };
}
async function drive({run,host,user,limits,log}){
  const seen=new Set();
  const watched={...run,status(){
    const status=run.status(),action=status.action;
    if(action&&!seen.has(action.callId)){seen.add(action.callId);if(action.name==='request_approval')log.approvals.push(action.payload?.kind||'');if(action.name==='request_input')log.questions.push(action.payload?.text||'');}
    return status;
  }};
  return driveEvaluationRun({run:watched,interaction:user,approveTransactions:true,limits,execute:action=>hostAction(host,action)});
}
const start=({routing,mode,options})=>routing==='direct'||mode==='template-register'?startAgent({...options,mode}):startIntentAgent({...options,mode:'auto'});

async function runCellCase({testCase,providers,routing,limits,agentOptions,log,host,path}){
  const initial=await host.call('init',testCase);
  const run=start({routing,mode:testCase.mode,options:{request:testCase.request,scope:initial.scope,providers,...agentOptions}});
  const user=simulatedUser({dialogue:testCase.dialogue,fields:testCase.templateFields,mapping:'strict',proposals:log.proposals});
  let state;
  try{state=await drive({run,host,user,limits,log});}
  catch(error){
    // Through the router a missing fact arrives as a question inside the run.
    if(testCase.state!=='awaiting_user'||error.message!=='evaluation_interaction_requires_human'||!log.questions.length)throw Object.assign(error,{status:run.status()});
    state={...run.status(),state:'awaiting_user',question:log.questions.at(-1)};
  }
  const after=await host.call('audit'),sourcesAfter=await host.call('auditSources'),reopened=await host.call('saveReopen',{path}),sourcesReopened=await host.call('auditSources');
  return{state,score:scoreCase(testCase,state,initial.before,after,reopened,{before:initial.sourcesBefore,after:sourcesAfter,reopened:sourcesReopened})};
}
async function runRegister({form,providers,limits,agentOptions,log,host}){
  const initial=await host.call('init',form);
  const run=start({routing:'direct',mode:'template-register',options:{request:form.register.request,scope:initial.scope,providers,...agentOptions}});
  const user=simulatedUser({dialogue:form.register.dialogue,fields:form.fields,mapping:'always',approvals:['template_register'],proposals:log.proposals});
  let state,failure;
  try{state=await drive({run,host,user,limits,log});}catch(error){failure=error;state=run.status();}
  const registered=state.registeredTemplate,proposed=registered?.profile?.fields||log.proposals.at(-1)||[];
  const score={mapping:scoreMapping(proposed,form.fields),registered:registered?.catalogued===true,sourceUnchanged:auditChanges(initial.before,await host.call('audit'),[]).length===0,proposedFields:proposed};
  if(failure)throw Object.assign(failure,{status:state,score});
  const passed=state.state==='done'&&score.registered&&score.sourceUnchanged&&score.mapping.exact;
  return{state,score:{...score,passed,outcome:passed?'passed':'failed'}};
}
async function runReuse({form,providers,routing,limits,agentOptions,log,host,path}){
  const initial=await host.call('init',form),session=createTemplateSession(initial.scope);
  session.confirm(session.propose(form.fields,initial.scope),initial.scope);
  // Start from the answer-key record so a registration mistake cannot affect this grade.
  const record=createTemplateRecord({name:form.title,purpose:form.title+' 작성',notes:'',profile:session.profile(),model:{model:'answer-key',provider:'evaluation'}});
  await host.call('template_register',{scopeId:initial.scope.scopeId,record,expectedFingerprint:initial.scope.fingerprint});
  await host.call('template_catalog_index',{templateId:record.id});
  const opened=await host.call('template_catalog_use',{templateId:record.id,auditRange:form.auditRange}),before=await host.call('audit');
  const binding={documentId:opened.scope.documentId,worksheet:opened.scope.worksheet,address:opened.scope.address};
  const run=start({routing,mode:'template',options:{request:form.reuse.request,scope:opened.scope,providers,templateRecord:opened.record,...(routing==='direct'?{}:{templateBinding:binding}),...agentOptions}});
  const user=simulatedUser({dialogue:form.reuse.dialogue,fields:form.fields,mapping:'strict',proposals:log.proposals});
  const state=await drive({run,host,user,limits,log}).catch(error=>{throw Object.assign(error,{status:run.status()});});
  const after=await host.call('audit'),reopened=await host.call('saveReopen',{path});
  const graded=scoreCase({checks:form.reuse.checks,allowedChanges:form.reuse.allowedChanges,state:'done'},state,before,after,reopened);
  const fresh=await host.call('template_catalog_use',{templateId:record.id}),templateUnchanged=isDeepStrictEqual(content(fresh.scope),content(opened.scope));
  const passed=graded.passed===true&&templateUnchanged;
  return{state,score:{...graded,templateUnchanged,passed,outcome:passed?'passed':'failed'}};
}

// A registered template is called by command or by sentence while another workbook is open.
async function runInvoke({testCase,providers,limits,agentOptions,log,host,path}){
  const installed=await installTemplates(host,catalogForms),blank=await host.call('init',blankWorkbook),form=testCase.form?formById(testCase.form):null;
  const run=startIntentAgent({request:testCase.request,scope:blank.scope,mode:'auto',templateCatalog:true,providers,...agentOptions});
  const user=simulatedUser({dialogue:testCase.dialogue,fields:form?.fields,mapping:'strict',proposals:log.proposals});
  const state=await drive({run,host,user,limits,log}).catch(error=>{throw Object.assign(error,{status:run.status()});});
  const opened=state.templateCopy?.entry?.id||null,expected=form?installed.get(form.id).record.id:null;
  if(!form){
    const after=await host.call('audit'),reopened=await host.call('saveReopen',{path});
    const graded=testCase.expect==='edit'?scoreCase({checks:testCase.checks,allowedChanges:testCase.allowedChanges,state:'done'},state,blank.before,after,reopened):null;
    const passed=opened===null&&(testCase.expect==='edit'?graded.passed===true:state.state==='unsupported'&&state.writes===0&&auditChanges(blank.before,after,[]).length===0);
    return{state,score:{...(graded||{}),openedTemplate:opened,expectedTemplate:null,passed,outcome:passed?'passed':'failed'}};
  }
  if(opened!==expected||state.state!=='done')return{state,score:{openedTemplate:opened,expectedTemplate:expected,selected:opened===expected,passed:false,outcome:'failed'}};
  const after=await host.call('audit',{range:form.auditRange}),openWorkbookUntouched=(await host.call('read',{scopeId:blank.scope.scopeId})).fingerprint===blank.scope.fingerprint;
  const reopened=await host.call('saveReopen',{path,range:form.auditRange});
  const graded=scoreCase({checks:form.reuse.checks,allowedChanges:form.reuse.allowedChanges,state:'done'},state,installed.get(form.id).before,after,reopened);
  const passed=graded.passed===true&&openWorkbookUntouched;
  return{state,score:{...graded,openedTemplate:opened,expectedTemplate:expected,selected:true,openWorkbookUntouched,passed,outcome:passed?'passed':'failed'}};
}

export async function evaluateSimulated({providers,suites=['register','reuse'],caseIds,trials=1,routing='product',outputDir,limits=EVALUATION_LIMITS,agentOptions={},extraInvokeCases=[],onResult=()=>{}}){
  if(!Array.isArray(suites)||!suites.length||suites.some(suite=>!SUITES.includes(suite)))fail('unknown_suite');
  if(!['product','direct'].includes(routing))fail('unknown_routing');
  if(!Number.isInteger(trials)||trials<1||trials>20)fail('invalid_trials');
  if(typeof outputDir!=='string'||!outputDir)fail('output_directory_required');
  const corpus=JSON.parse(await readFile(resolve(root,'eval/cases.json'),'utf8'));
  const planned=suites.flatMap(suite=>(['edit','template'].includes(suite)?corpus.cases.filter(item=>item.mode===suite):suite==='invoke'?[...invokeCases,...extraInvokeCases]:forms).filter(item=>!caseIds||caseIds.includes(item.id)).map(item=>({suite,item})));
  if(!planned.length||caseIds?.some(id=>!planned.some(plan=>plan.item.id===id)))fail('unknown_case');
  await mkdir(outputDir,{recursive:true});
  const status=providers.status(),runId=randomUUID();
  const report={kind:'simulated-host-live-model-evaluation',schema:1,runId,provider:status.provider,model:status.model,routing,caseVersion:corpus.version,startedAt:new Date().toISOString(),limits,
    host:{platform:'simulated',simulated:true,calculator:'@ironcalc/nodejs'},results:[],limitations:LIMITATIONS};
  for(const {suite,item} of planned)for(let trial=1;trial<=trials;trial++){
    const name=`${suite}-${item.id}-t${trial}`,directory=resolve(outputDir,name),entries=[],log={questions:[],approvals:[],proposals:[]},host=createSimHost();
    const context={testCase:item,form:item,providers:recordingProviders(providers,entry=>entries.push(entry)),routing,limits,agentOptions,log,host,path:`/sim/results/${runId}/${name}.xlsx`};
    let state,score,error;
    try{({state,score}=await(suite==='register'?runRegister(context):suite==='reuse'?runReuse(context):suite==='invoke'?runInvoke(context):runCellCase(context)));}
    catch(cause){error=safeError(cause);state=cause.status;score=cause.score;}
    finally{host.close();}
    const passed=error?false:score.passed,outcome=error?'error':score.outcome;
    const result={suite,id:item.id,trial,routing:suite==='register'?'direct':routing,passed,outcome,state:state?.state,...(error?{error}:{}),...(state?.error?{agentError:state.error}:{}),writes:state?.writes??0,recoveries:state?.recoveries?.length??0,
      questions:log.questions,approvals:log.approvals,proposals:log.proposals.length,metrics:{modelCalls:state?.metrics?.modelCalls,toolCalls:state?.metrics?.toolCalls,elapsedMs:state?.metrics?.elapsedMs},transcript:summarize(entries),score};
    await mkdir(directory,{recursive:true});
    await writeFile(resolve(directory,'transcript.jsonl'),entries.map(entry=>JSON.stringify(entry)).join('\n')+(entries.length?'\n':''));
    await writeFile(resolve(directory,'result.json'),JSON.stringify({...result,request:suite==='register'?item.register.request:suite==='reuse'?item.reuse.request:item.request,openedTemplate:state?.templateCopy?.entry,answer:state?.answer,question:state?.question,
      plan:state?.plan,task:state?.task,review:state?.review,trace:state?.trace,recoveryLog:state?.recoveries,lastProposal:log.proposals.at(-1),registeredTemplate:state?.registeredTemplate},null,2)+'\n');
    report.results.push(result);onResult(result);
  }
  const bySuite={};
  for(const result of report.results){
    const tally=bySuite[result.suite]??={total:0,passed:0,failed:0,needsReview:0,errors:0};tally.total++;
    tally[result.outcome==='passed'?'passed':result.outcome==='needs_review'?'needsReview':result.outcome==='error'?'errors':'failed']++;
  }
  report.summary={bySuite,modelCalls:report.results.reduce((sum,result)=>sum+result.transcript.modelCalls,0),modelElapsedMs:report.results.reduce((sum,result)=>sum+result.transcript.elapsedMs,0)};
  report.finishedAt=new Date().toISOString();
  await writeFile(resolve(outputDir,'report.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const option=name=>{const index=process.argv.indexOf('--'+name);return index>0?process.argv[index+1]:undefined;};
  const {connectRelayProviders}=await import('./relay-providers.mjs'),{defaultSocketPath}=await import('./model-session.mjs');
  const outputDir=resolve(option('out')||resolve(root,'verification/sim-live',new Date().toISOString().replace(/[:.]/g,'-')));
  let providers;
  try{providers=await connectRelayProviders({socketPath:option('socket')||defaultSocketPath()});}
  catch{console.error('모델 세션에 연결하지 못했습니다. 먼저 node eval/sim/model-session.mjs 를 실행하고 로그인해 주세요.');process.exit(2);}
  try{
    const report=await evaluateSimulated({providers,suites:(option('suites')||'register,reuse').split(','),caseIds:option('cases')?.split(','),trials:Number(option('trials')||1),routing:option('routing')||'product',outputDir,
      onResult:result=>console.log([result.outcome.padEnd(12),result.suite.padEnd(9),result.id.padEnd(32),'모델 호출 '+String(result.transcript.modelCalls).padStart(3),Math.round(result.transcript.elapsedMs/1000)+'초',result.error||''].join(' '))});
    console.log(JSON.stringify({model:report.model,routing:report.routing,summary:report.summary,report:resolve(outputDir,'report.json')},null,2));
    console.log('모의 호스트 결과입니다. 실제 Excel 2016이나 사내 Qwen의 성능이 아닙니다.');
  }finally{providers.dispose();}
}
