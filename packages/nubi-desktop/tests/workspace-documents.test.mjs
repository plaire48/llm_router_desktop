import {createWorkerScheduler} from '../runtime/research-agent.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir,symlink,truncate} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {documentSnapshot,analyzeWorkspaceDocuments,documentAnalysisResult,DOCUMENT_LIMITS} from '../runtime/workspace-documents.mjs';
import {readSource} from '../runtime/files.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);
const signal=()=>new AbortController().signal;
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const report=ids=>({status:'complete',answer:'문서에서 요구사항을 확인했습니다.',findings:ids.length?[{text:'원문 근거',citations:ids.slice(0,3)}]:[],uncertainties:[]});
function researchModel({onRead=()=>{}}={}){
  return async(messages,tools)=>{
    assert.ok(tools.every(tool=>['read_wiki','search_wiki'].includes(tool.function.name)),'Children cannot access native input, filesystem, approvals or recursive delegation');
    const prompt=messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
    if(prompt.includes('Plan OpenWiki research'))return {content:JSON.stringify({mode:'comprehensive',questions:['문서 전체 요구사항 확인']})};
    if(prompt.includes('Synthesize'))return {content:JSON.stringify(report(JSON.parse(messages.at(-1).content).evidence.map(item=>item.id)))};
    const assignment=JSON.parse(messages.find(message=>message.role==='user').content).assignment;
    const reads=messages.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content)).filter(item=>item.id);
    if(reads.length)await onRead(reads);
    const start=reads.at(-1)?.end??assignment.range?.start??0;
    if(reads.length&&start>=assignment.range.end)return {content:JSON.stringify(report(reads.map(item=>item.id)))};
    return call('read_wiki',{documentId:assignment.documentIds[0],start,length:Math.min(6000,assignment.range.end-start)});
  };
}

test('large UTF-8 snapshots retain every character without widening source edit reads',async t=>{
  const {root}=await fixture(t),text='한글 문서\n'.repeat(100000);
  await writeFile(path.join(root,'large.md'),text);
  await assert.rejects(()=>readSource(root,'large.md',{maxBytes:1024*1024}),/file_too_large/);
  const docs=await documentSnapshot(root,['large.md'],signal());
  assert.equal(docs[0].text,text);assert.equal(docs[0].path,'large.md');assert.match(docs[0].version,/^sha256:/);
});

test('workspace document snapshots reject private paths, links, binary, wrong encoding and limits',async t=>{
  const {root,directory}=await fixture(t);
  await writeFile(path.join(root,'.env'),'SECRET=private');
  await writeFile(path.join(directory,'outside.md'),'outside');
  await symlink(path.join(directory,'outside.md'),path.join(root,'link.md'));
  await mkdir(path.join(root,'docs'));await symlink(path.join(root,'docs'),path.join(root,'linked'));
  await writeFile(path.join(root,'docs','real.md'),'safe');
  await writeFile(path.join(root,'binary.txt'),Buffer.from([0,1]));
  await writeFile(path.join(root,'invalid.txt'),Buffer.from([255,254]));
  await writeFile(path.join(root,'layout.pdf'),'%PDF-1.7\nASCII PDF is not extracted text');
  await writeFile(path.join(root,'oversize.txt'),'');await truncate(path.join(root,'oversize.txt'),DOCUMENT_LIMITS.bytes+1);
  for(const [file,error] of [['../outside.md',/path_scope/],['.env',/path_scope/],['link.md',/document_scope/],['linked/real.md',/document_scope/],['binary.txt',/document_encoding/],['invalid.txt',/document_encoding/],['layout.pdf',/document_format/],['oversize.txt',/document_limit/]])await assert.rejects(()=>documentSnapshot(root,[file],signal()),error);
  await assert.rejects(()=>documentSnapshot(root,['app.txt','app.txt'],signal()),/document_arguments/);
  await assert.rejects(()=>documentSnapshot(root,['app.txt'],AbortSignal.abort()),/abort/i);
});

test('OpenWiki workers cover past 40k, emit scoped progress and preserve a recoverable receipt',async t=>{
  const {root,service}=await fixture(t),text='정책 상세 및 요구사항 확인\n'.repeat(4000);
  await writeFile(path.join(root,'large.md'),text);const events=[];let record;
  const result=await analyzeWorkspaceDocuments({root,args:{paths:['large.md'],question:'문서 전체를 읽고 요구사항을 정리해 주세요.'},signal:signal(),modelId:'fixture',complete:researchModel(),taskId:'task',runId:'run',store:service.store,onRecord:value=>{record=structuredClone(value);events.push(record);}});
  assert.equal(result.status,'complete');assert.equal(result.advisory,true);assert.equal(result.coverage.mode,'comprehensive');assert.deepEqual(result.coverage.unreadRanges,[]);
  assert.ok(result.coverage.tasks>=3);
  assert.ok(events.some(e=>e.workers.some(w=>w.phase==='reading'&&w.range?.start>=40000)));
  assert.ok(events.some(e=>e.workers.some(w=>w.role==='synthesis'&&w.phase==='synthesizing')));
  assert.equal(record.state,'complete');assert.equal(record.sources[0].characters,text.length);
  const saved=service.store.get('document-analysis:'+result.id);
  const recovered=documentAnalysisResult(saved);assert.deepEqual(recovered,result);
  const excerpt=documentAnalysisResult(saved,result.evidence[0].id);assert.equal(excerpt.historical,true);assert.ok(excerpt.evidence.excerpt.length>0);
  assert.throws(()=>documentAnalysisResult(saved,'invented'),/document_evidence_missing/);
});

test('source changes during research prevent exposing stale conclusions',async t=>{
  const {root,service}=await fixture(t);let changed=false,record;
  const complete=researchModel({onRead:async()=>{if(!changed){changed=true;await writeFile(path.join(root,'app.txt'),'changed');}}});
  await assert.rejects(()=>analyzeWorkspaceDocuments({root,args:{paths:['app.txt'],question:'문서 전체 확인'},signal:signal(),modelId:'fixture',complete,taskId:'task',runId:'run',store:service.store,onRecord:value=>{record=structuredClone(value);}}),/document_changed/);
  assert.equal(record.state,'failed');assert.equal(record.result,undefined);assert.throws(()=>documentAnalysisResult(record),/document_result_unavailable/);
});

test('cancellation preserves progress without synthesizing or restarting children',async t=>{
  const {root,service}=await fixture(t),controller=new AbortController();let record,synthesis=0;
  const base=researchModel({onRead:async()=>{controller.abort();controller.signal.throwIfAborted();}});
  await assert.rejects(()=>analyzeWorkspaceDocuments({root,args:{paths:['app.txt'],question:'문서 전체 확인'},signal:controller.signal,modelId:'fixture',complete:async(...args)=>{if(args[0].some(m=>m.content?.includes('Synthesize')))synthesis++;return base(...args);},taskId:'task',runId:'run',store:service.store,onRecord:value=>{record=structuredClone(value);}}),/abort/i);
  assert.equal(record.state,'cancelled');assert.equal(synthesis,0);assert.ok(record.workers.length);assert.equal(record.result,undefined);
});

test('Desktop Pi invokes document analysis, persists progress and recovers only this task receipt',async t=>{
  const {root,service}=await fixture(t);await writeFile(path.join(root,'large.md'),'업무 규칙 확인\n'.repeat(5000));
  let turn=0,result;
  const child=researchModel();
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:64000}]}),dispose(){},complete:async(messages,tools)=>{
    if(messages.some(m=>m.role==='system'&&(/^(Plan OpenWiki research|You are OpenWiki's read-only evidence researcher)/.test(m.content))))return child(messages,tools);
    // DeepAgents read-only calls expose only Wiki tools or a structured planner/synthesis prompt.
    if(tools.length&&tools.every(tool=>['read_wiki','search_wiki'].includes(tool.function.name)))return child(messages,tools);
    turn++;
    if(turn===1)return call('analyze_documents',{paths:['large.md'],question:'전체 문서의 업무 규칙을 정리해 주세요.'});
    if(turn===2){result=JSON.parse(messages.findLast(m=>m.role==='tool').content);assert.equal(result.engine,'openwiki-deepagents');return call('read_document_analysis',{id:result.id});}
    if(turn===3){assert.equal(JSON.parse(messages.findLast(m=>m.role==='tool').content).id,result.id);return call('read_document_analysis',{id:'another-task'});}
    assert.match(messages.findLast(m=>m.role==='tool').content,/document_result_unavailable/);return {content:'문서 분석을 정리했습니다. 앱은 조작하지 않았습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'large.md 전체를 검토해 주세요.'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',JSON.stringify(service.task(task.id)));assert.equal(service.task(task.id).documentAnalysis.state,'complete');
  assert.equal((service.task(task.id).sources||[]).length,0,'Child document reads do not grant source editing observations');
  assert.equal(service.state().proposals.length,0);assert.equal(service.state().processes.length,0);
});

test('Desktop document authentication failure stops parent inference and leaves a failed receipt',async t=>{
  const {service}=await fixture(t);let parentCalls=0,childCalls=0;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:64000}]}),dispose(){},complete:async(messages)=>{
    if(messages.some(m=>m.role==='system'&&m.content.startsWith('Plan OpenWiki research'))){childCalls++;throw Object.assign(Error('unauthorized'),{status:401});}
    parentCalls++;return call('analyze_documents',{paths:['app.txt'],question:'문서 전체 확인'});
  }};
  const task=await service.createTask({request:'app.txt 전체 확인'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(parentCalls,1);assert.equal(childCalls,1);assert.equal(service.task(task.id).state,'paused');
  assert.equal(service.task(task.id).documentAnalysis.state,'failed');assert.equal(service.task(task.id).documentAnalysis.workers.length,0);
});

test('isolated service suppresses inherited tracing before framework imports',async()=>{
  const previous=process.env.LANGSMITH_TRACING;
  const {stdout,stderr}=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./document-tracing-fixture.mjs',import.meta.url))],{env:{...process.env,LANGSMITH_TRACING:'true',LANGCHAIN_TRACING:'true',LANGCHAIN_TRACING_V2:'true',LANGSMITH_ENDPOINT:'http://127.0.0.1:1',LANGSMITH_API_KEY:'fixture-not-a-key'},timeout:20000});
  assert.deepEqual(JSON.parse(stdout.trim()),{status:'complete',requests:0,tracing:null});
  assert.doesNotMatch(stderr,/Failed to send|multipart|fixture_network_denied/);
  assert.equal(process.env.LANGSMITH_TRACING,previous,'Parent environment remains unchanged');
});

test('host restart preserves worker responses but never revives an unfinished document run',async t=>{
  const {root,service}=await fixture(t),task=await service.createTask({request:'문서 분석'});
  const progress={id:'interrupted-document',taskId:task.id,state:'running',phase:'reading',workers:[{taskId:0,phase:'finished',outcome:'partial',summary:'수신한 부분 결과'},{taskId:1,phase:'reading'}]};
  service.store.set('document-analysis:'+progress.id,progress);service.store.set('task:'+task.id,{...task,state:'running',documentAnalysis:progress});
  service.store.close();await service.open(root);
  const saved=service.task(task.id);assert.equal(saved.state,'interrupted');assert.equal(saved.documentAnalysis.state,'interrupted');
  assert.equal(saved.documentAnalysis.workers[0].summary,'수신한 부분 결과');assert.equal(saved.documentAnalysis.workers[1].phase,'interrupted');
  assert.equal(service.store.get('document-analysis:'+progress.id).state,'interrupted');assert.throws(()=>documentAnalysisResult(service.store.get('document-analysis:'+progress.id)),/document_result_unavailable/);
});


test('document research shares remaining admissions and preserves unread ranges when the host limit is reached',async t=>{
 const {root,service}=await fixture(t);await writeFile(path.join(root,'shared.md'),'A'.repeat(96000));
 const scheduler=createWorkerScheduler();assert.equal(scheduler.admit(5),true);
 const result=await analyzeWorkspaceDocuments({root,args:{paths:['shared.md'],question:'전체 내용 확인'},scheduler,signal:signal(),modelId:'fixture',complete:researchModel(),taskId:'task',runId:'run',store:service.store});
 assert.notEqual(result.status,'complete');assert.ok(result.coverage.budgetLimitedTasks>=3);assert.ok(result.coverage.unreadRanges.length>=3);assert.ok(result.uncertainties.some(s=>s.includes('한도')));assert.equal(scheduler.admit(),false);
 const record=service.store.get('document-analysis:'+result.id);assert.equal(record.workers.filter(w=>w.role==='research'&&w.outcome!=='blocked').length,1);
});

test('document workers share physical slots with an existing research job',async t=>{
 const {root}=await fixture(t);await writeFile(path.join(root,'shared.md'),'A'.repeat(96000));
 const pool=createWorkerScheduler();let active=0,peak=0;const scheduler={admit:n=>pool.admit(n),schedule:(work,s)=>pool.schedule(async()=>{active++;peak=Math.max(peak,active);try{return await work();}finally{active--;}},s)};
 let release;const other=scheduler.schedule(()=>new Promise(r=>{release=r;}));await new Promise(r=>setImmediate(r));
 let first=true;
 const result=await analyzeWorkspaceDocuments({root,args:{paths:['shared.md'],question:'전체 내용 확인'},scheduler,signal:signal(),modelId:'fixture',complete:researchModel({onRead:async()=>{if(first){first=false;assert.equal(active,2);release();await other;}}}),taskId:'task',runId:'run'});
 assert.equal(result.status,'complete');assert.equal(peak,2);assert.equal(active,0);
});

test('exhausted document admissions do not spend model calls synthesizing unstarted workers',async t=>{
 const {root}=await fixture(t);await writeFile(path.join(root,'shared.md'),'A'.repeat(96000));const scheduler=createWorkerScheduler();scheduler.admit(6);let modelCalls=0;const complete=researchModel();
 const result=await analyzeWorkspaceDocuments({root,args:{paths:['shared.md'],question:'전체 확인'},scheduler,signal:signal(),modelId:'fixture',complete:(...args)=>{modelCalls++;return complete(...args);},taskId:'task',runId:'run'});
 assert.equal(result.status,'blocked');assert.equal(modelCalls,1,'only the planner runs; unstarted assignments have no findings to synthesize');assert.equal(result.coverage.budgetLimitedTasks,4);assert.equal(result.coverage.unreadRanges.length,4);
});

test('a fresh document recovery context consumes the same remaining admissions',async t=>{
 const {root}=await fixture(t);const scheduler=createWorkerScheduler();scheduler.admit(5);let researchCalls=0;
 const result=await analyzeWorkspaceDocuments({root,args:{paths:['app.txt'],question:'전체 확인'},scheduler,signal:signal(),modelId:'fixture',complete:async(messages)=>{
 const prompt=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');if(prompt.includes('Plan OpenWiki research'))return {content:JSON.stringify({mode:'comprehensive',questions:['전체']})};if(!prompt.includes('Synthesize'))researchCalls++;return {content:JSON.stringify({status:'blocked',answer:'원문을 읽지 못했습니다.',findings:[],uncertainties:['미확인']})};},taskId:'task',runId:'run'});
 assert.equal(researchCalls,1);assert.ok(result.coverage.budgetLimitedTasks);assert.ok(result.coverage.unreadRanges.length);assert.notEqual(result.status,'complete');
});

test('queued document workers cancel without model reads and release only their own queue entries',async t=>{
 const {root}=await fixture(t);const scheduler=createWorkerScheduler(),controller=new AbortController(),held=[];const occupied=[scheduler.schedule(()=>new Promise(r=>held.push(r))),scheduler.schedule(()=>new Promise(r=>held.push(r)))];await new Promise(r=>setImmediate(r));let planned=false,reads=0;
 const pending=analyzeWorkspaceDocuments({root,args:{paths:['app.txt'],question:'전체 확인'},scheduler,signal:controller.signal,modelId:'fixture',complete:async(messages)=>{if(String(messages[0].content).includes('Plan OpenWiki research')){planned=true;return {content:JSON.stringify({mode:'comprehensive',questions:['전체']})};}reads++;return {content:JSON.stringify(report([]))};},taskId:'task',runId:'run'});
 const cancelled=assert.rejects(pending,/abort|cancelled/i);for(let i=0;i<100&&!planned;i++)await new Promise(r=>setTimeout(r,5));assert.ok(planned);await new Promise(r=>setTimeout(r,10));controller.abort();await cancelled;assert.equal(reads,0);held.forEach(r=>r());await Promise.all(occupied);assert.equal(await scheduler.schedule(()=>42),42);
});
