import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createClaudeCode} from '../../nubi-desktop/runtime/claude-code.mjs';
import {createScreenKnowledge,createModelScreenAnalyzer} from '../dist/knowledge.js';
import {createWikiScreenStore,screenWikiPath} from '../dist/knowledge-wiki.js';
import {createPlaywrightScreenSource} from '../dist/knowledge-playwright.js';
import {createStagehandScreenAnalyzer} from '../dist/stagehand.js';
import {stagehandBrowserHost} from '../evaluation/stagehand-browser-host.mjs';
import {fileWikiDocuments} from '../evaluation/wiki-document-host.mjs';
import {startScreenKnowledgeSite} from '../evaluation/screen-knowledge-site.mjs';
import {retrieveWikiEvidence} from '../../openwiki/dist/visualize/retrieval.js';

const output=process.argv[2];if(!output)throw Error('report_path_required');
const selected=process.argv[3]??'all';if(!['all','probe','public'].includes(selected))throw Error('unknown_suite');
await mkdir(dirname(output),{recursive:true});
const report={schemaVersion:1,startedAt:new Date().toISOString(),actualModel:true,actualStagehand:true,stagehandVersion:'3.7.3',scope:selected==='public'?'anonymous_naver_search_form':'synthetic_development_screens',workspaceIntegrated:false,companyVerified:false,trials:[],limits:['Bounded development screens, not a general public/company quality score.','Standard Stagehand extract uses its own DOM acquisition and two host model completions; baseline uses the existing structural evidence and one completion.','Host browser launch and SDK/provider connection are reported separately. Analysis/save/readback and cold module recall are measured.','No raw page snapshots, model prompts, network headers or user credentials in this report. Wiki candidates exclude current input values.']};
const persist=()=>writeFile(output,JSON.stringify(report,null,2)+'\n');
report.hashes=Object.fromEntries(await Promise.all(['../src/knowledge.ts','../src/knowledge-wiki.ts','../src/knowledge-playwright.ts','../src/knowledge-files.ts','../src/stagehand.ts','../scripts/screen-knowledge-live.mjs','../evaluation/wiki-document-host.mjs'].map(async name=>[name,createHash('sha256').update(await readFile(new URL(name,import.meta.url))).digest('hex')])));
const provider=createClaudeCode({contextWindows:()=>Promise.resolve(new Map())});let browser,site,controller=new AbortController(),active;
try{
 const connected=performance.now(),status=await provider.connect();report.providerConnectMs=performance.now()-connected;report.model=status.model;report.effort=status.reasoningEffort;
 const model={id:status.model,async complete(messages,tools,ctx){const start=performance.now();try{return await provider.complete(messages,tools,ctx.signal,text=>{if(text)ctx.onEvent({type:'first_content'});},()=>{},()=>{},{backgroundModel:{provider:'claude',model:ctx.modelId},typedToolArguments:true});}finally{if(active){active.modelMs??=[];active.modelMs.push(performance.now()-start);active.inputCharacters??=[];active.inputCharacters.push(JSON.stringify(messages).length);}}}};
 const launch=performance.now();browser=await stagehandBrowserHost(model,()=>controller.signal);report.browserSdkSetupMs=performance.now()-launch;report.browserVersion=browser.version;site=await startScreenKnowledgeSite();
 const definitions=[{id:'search',type:'search',title:'자료 검색',fields:['검색어','분류'],actions:['조회']},{id:'compose',type:'editor',title:'자료 작성',fields:['대상','내용'],actions:['목록','임시 저장']},{id:'detail',type:'detail',title:'요청 상세',fields:[],actions:['편집','돌아가기']}];
 const cases=selected==='public'?[{id:'naver',type:'search',title:'NAVER',fields:['검색어를 입력해 주세요.'],actions:['AI 검색'],url:'https://www.naver.com/',selector:'form[role=search],form#sform'}]:selected==='probe'?definitions.slice(0,1):definitions;
 for(const definition of cases)for(let repeat=1;repeat<=(selected==='probe'?1:3);repeat++)for(const method of repeat%2?['baseline','stagehand']:['stagehand','baseline']){
  const row={case:definition.id,repeat,method,success:false,modelMs:[]};report.trials.push(row);active=row;controller=new AbortController();const timer=setTimeout(()=>controller.abort(),150_000);const start=performance.now();
  try{
   const origin=new URL(definition.url??site.origin).origin;await browser.page.goto(definition.url??site.origin+'/'+definition.id,{waitUntil:'load',timeout:30000});if(definition.id==='compose')await browser.page.frameLocator('iframe').locator('[contenteditable]').waitFor();if(definition.selector)await browser.page.locator(definition.selector).first().waitFor();
   const source=createPlaywrightScreenSource({page:browser.page,screenId:definition.id,variantId:'default',access:async()=>new URL(browser.page.url()).origin===origin,roots:()=>definition.selector?[{frame:browser.page.mainFrame(),root:browser.page.locator(definition.selector).first()}]:browser.page.frames().map(frame=>({frame,root:frame.locator('body')}))});
   const scope={projectId:'screen-live',systemId:'fixture-'+definition.id,environmentId:'evaluation',accessScopeId:'anonymous'};
   const documents=fileWikiDocuments(join(dirname(output),'wiki-'+method+'-'+repeat)),store=createWikiScreenStore(documents);
   const analyzer=method==='baseline'?createModelScreenAnalyzer(model):createStagehandScreenAnalyzer({stagehand:browser.sdk,modelBridge:browser.modelBridge,page:browser.page,validate:source.validate,...(definition.selector?{selector:definition.selector}:{}),timeoutMs:120000});
   const service=createScreenKnowledge({scope,source,store,analyzer});const at=performance.now(),saved=await service.analyzeAndSave(controller.signal,{force:true});row.analysisSaveMs=performance.now()-at;
   const {record}=saved;row.classification=record.analysis.screenType;row.fieldLabels=record.analysis.fieldEvidenceIds.map(id=>record.evidence.facts.find(f=>f.id===id).text);row.actionLabels=record.analysis.actionEvidenceIds.map(id=>record.evidence.facts.find(f=>f.id===id).text);row.title=record.evidence.facts.find(f=>f.id===record.analysis.titleEvidenceId).text;
   const exact=(a,b)=>a.length===b.length&&a.every(x=>b.includes(x));row.correct=record.analysis.screenType===definition.type&&row.title===definition.title&&exact(row.fieldLabels,definition.fields)&&exact(row.actionLabels,definition.actions);row.coverage=record.evidence.coverage;
   const path=await screenWikiPath(scope,definition.id,'default'),doc=await documents.read(path,scope,controller.signal);row.wikiPath=path;row.noCurrentValues=!/CURRENT_|DO_NOT_STORE/.test(doc.content);row.openWikiSearchHits=retrieveWikiEvidence([{id:path,title:row.title,raw:doc.content}],definition.fields.join(' ')||definition.title,3).results.length;
   await browser.page.reload({waitUntil:'load'});if(definition.id==='compose')await browser.page.frameLocator('iframe').locator('[contenteditable]').waitFor();
   // A fresh module/store reads real persisted Markdown. No prior analysis object is reused.
   const fresh=createScreenKnowledge({scope,source,store:createWikiScreenStore(fileWikiDocuments(join(dirname(output),'wiki-'+method+'-'+repeat))),analyzer});
   const beforeCalls=row.modelMs.length,recallAt=performance.now(),recalled=await fresh.recall(controller.signal);row.coldRecallMs=performance.now()-recallAt;row.recallStatus=recalled.status;row.recallModelCalls=row.modelMs.length-beforeCalls;
   const reuseAt=performance.now(),again=await fresh.analyzeAndSave(controller.signal);row.unchangedReuseMs=performance.now()-reuseAt;row.analysisSkipped=again.reused;row.success=!!(row.correct&&row.noCurrentValues&&row.openWikiSearchHits&&recalled.status==='matched'&&row.recallModelCalls===0&&again.reused);
  }catch(error){row.error={name:error.name,code:error.code??'unknown',message:String(error.message).slice(0,240)};}
  finally{clearTimeout(timer);row.totalMs=performance.now()-start;active=undefined;await persist();console.log(JSON.stringify({event:'trial',case:definition.id,repeat,method,success:row.success,analysisMs:row.analysisSaveMs,recallMs:row.coldRecallMs,calls:row.modelMs.length,error:row.error}));}
 }
 report.finishedAt=new Date().toISOString();
}catch(error){report.error={name:error.name,message:String(error.message).slice(0,200)};throw error;}
finally{controller.abort();provider.disconnect();await browser?.close();await site?.close();await persist();}
