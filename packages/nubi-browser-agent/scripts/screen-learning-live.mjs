import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {createClaudeCode} from '../../nubi-desktop/runtime/claude-code.mjs';
import {createModelScreenAnalyzer} from '../dist/knowledge.js';
import {createScreenLearning} from '../dist/knowledge-learning.js';
import {createPlaywrightScreenSource} from '../dist/knowledge-playwright.js';
import {createWikiScreenStore} from '../dist/knowledge-wiki.js';
import {createFileWikiDocuments} from '../dist/knowledge-files.js';

const mode=process.argv[3]??'ambiguous';if(!['ambiguous','clear'].includes(mode))throw Error('unknown_suite');
const output=process.argv[2];if(!output?.startsWith('/'))throw Error('absolute_report_required');await mkdir(dirname(output),{recursive:true});
const report={schemaVersion:1,mode,startedAt:new Date().toISOString(),actualModel:true,actualChrome:true,humanAnswers:'scripted fixture business explanations, not real user input',workspaceIntegrated:false,trials:[],limits:['One '+mode+' synthetic screen, three fresh wiki repositories. Not an unregistered-site or business-quality score.','Model generates uncertainty topics and evidence references; the module supplies question text. Human answer content and timing are simulated.','Initial learning includes source observation, one model analysis, CAS/readback and question preparation. Reuse includes fresh structure checks and wiki reads. Browser/provider setup and human think time are separate.','No browsing action execution, account authentication or company data is involved.']};
const persist=()=>writeFile(output,JSON.stringify(report,null,2)+'\n');
report.sourceHashes=Object.fromEntries(await Promise.all(['knowledge.ts','knowledge-learning.ts','knowledge-wiki.ts','knowledge-files.ts','knowledge-playwright.ts','pi.ts','types.ts','lifecycle.ts','contracts.ts'].map(async name=>[name,createHash('sha256').update(await readFile(new URL('../src/'+name,import.meta.url))).digest('hex')])));
const provider=createClaudeCode({contextWindows:()=>Promise.resolve(new Map())});let browser,active;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
try{
 let at=performance.now();const status=await provider.connect();report.providerConnectMs=performance.now()-at;report.model=status.model;report.reasoningEffort=status.reasoningEffort;
 const model={id:status.model,async complete(messages,tools,ctx){const start=performance.now();try{return await provider.complete(messages,tools,ctx.signal,()=>{},()=>{},()=>{},{backgroundModel:{provider:'claude',model:ctx.modelId},typedToolArguments:true});}finally{if(active){active.modelCalls++;active.modelMs.push(performance.now()-start);}}}};
 at=performance.now();browser=await chromium.launch({headless:true,channel:'chrome'});report.browserSetupMs=performance.now()-at;report.browserVersion=browser.version();
 for(let repeat=1;repeat<=3;repeat++){
  const row={repeat,success:false,modelCalls:0,modelMs:[]};report.trials.push(row);active=row;const total=performance.now(),context=await browser.newContext({locale:'ko-KR'}),page=await context.newPage();
  try{
   await page.setContent(mode==='clear'?'<html lang="ko"><title>자료 검색</title><main><h1>자료 검색</h1><form aria-label="검색 조건"><label>검색어<input name="query" value="CURRENT_VALUE_DO_NOT_STORE"></label><button type="button">조회</button></form></main></html>':'<html lang="ko"><title>업무 관리</title><main><h1>업무 관리</h1><form aria-label="업무 양식"><label>구분<input name="category" value="CURRENT_VALUE_DO_NOT_STORE"></label><button type="button">처리</button></form></main></html>');
   const source=createPlaywrightScreenSource({page,screenId:'generic-screen',variantId:'default',access:async()=>true,roots:()=>[{frame:page.mainFrame(),root:page.locator('main')}]});
   const scope={projectId:'screen-learning-live',systemId:'generic',environmentId:'fixture',accessScopeId:'reader'},store=createWikiScreenStore(createFileWikiDocuments({root:dirname(output),authorize:async()=>true}));
   // Distinct system scope per repeat freezes initial discovery independently.
   scope.systemId='generic-'+repeat;
   const binding={tabId:'page',documentId:String(await page.evaluate(()=>performance.timeOrigin)),revision:'r1'},ctx={projectId:scope.projectId,task:{taskId:'learn-'+repeat,runId:'run-'+repeat,request:'이 업무 화면의 용도를 파악하고 안내 지식을 저장한다.',criteria:['learning']},observation:{state:'ready',binding,observationId:'o-'+repeat},signal:controller.signal};
   const options={scope,source,store,analyzer:createModelScreenAnalyzer(model,{learning:true}),validateContext:async c=>c.observation.binding.documentId===String(await page.evaluate(()=>performance.timeOrigin)),allowAnswer:async()=>true};
   let learning=createScreenLearning(options);at=performance.now();let question=await learning.port.next(ctx);row.initialLearningMs=performance.now()-at;row.questions=[];const initialCalls=row.modelCalls;
   while(question){row.questions.push({question:question.question,context:question.context,inputMode:question.inputMode,choices:question.choices});const record=(await store.read(scope,'generic-screen','default',controller.signal)).record;const q=record.analysis.questions.find(q=>!record.clarifications?.some(a=>a.questionId===q.id));const answer=q.topic==='screen_purpose'?'승인과 결재':q.topic==='control_meaning'?'처리는 검토 담당자에게 승인 요청을 보내는 기능입니다.':'요청 전에 업무 분류를 선택합니다.';await learning.port.answer(ctx,question.learningKey,answer);question=await learning.port.next(ctx);}
   row.learningAndScriptedAnswersMs=performance.now()-total;const before=row.modelCalls;learning=createScreenLearning({...options,store:createWikiScreenStore(createFileWikiDocuments({root:dirname(output),authorize:async()=>true}))});at=performance.now();const reused=await learning.port.next(ctx),recall=await learning.knowledge.recall(controller.signal);row.reuseMs=performance.now()-at;row.reuseModelCalls=row.modelCalls-before;
   row.checks={questionDecision:mode==='ambiguous'?row.questions.length>=1&&row.questions.length<=2:row.questions.length===0,oneAnalysisCall:initialCalls===1&&row.modelCalls===1,noRepeatQuestion:reused===null,noReuseModelCalls:row.reuseModelCalls===0,userProvenance:row.questions.length===0?!recall.record.clarifications?.length:recall.record.clarifications?.every(a=>a.source==='user'&&a.status==='answered')===true,userGuidanceIncluded:row.questions.length===0?!recall.notes[0].includes('사용자 설명'):recall.notes[0].includes('사용자 설명'),noInputValues:!JSON.stringify(recall).includes('CURRENT_VALUE_DO_NOT_STORE')};row.success=Object.values(row.checks).every(Boolean);
  }catch(error){row.error={code:error.code??error.name};}finally{row.totalMs=performance.now()-total;await context.close();active=undefined;await persist();console.log(JSON.stringify({repeat,success:row.success,initialLearningMs:row.initialLearningMs,reuseMs:row.reuseMs,modelCalls:row.modelCalls,questions:row.questions?.length,error:row.error}));}
 }
 report.finishedAt=new Date().toISOString();
}catch(error){report.error={code:error.code??error.name};}finally{clearTimeout(timer);controller.abort();provider.disconnect();await browser?.close();await persist();}
if(report.error||report.trials.length!==3||report.trials.some(t=>!t.success))process.exitCode=1;
