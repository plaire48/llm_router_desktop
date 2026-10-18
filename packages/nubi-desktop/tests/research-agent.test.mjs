import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createResearchAgent,createWorkerScheduler} from '../runtime/research-agent.mjs';
import {createAnalysisCoordinator} from '../../../extensions/aipro-chat/analysis-agents.js';
import {runAgent} from '../../../extensions/aipro-chat/agent-runtime.js';
const tool=(name,properties,required=[])=>({type:'function',function:{name,description:name,parameters:{type:'object',properties,required,additionalProperties:false}}});
const read=tool('read_source',{path:{type:'string'},start:{type:'integer'},end:{type:'integer'}},['path']);
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const report=()=>({content:JSON.stringify({summary:'A는 1',findings:[{claim:'A는 1',source:{path:'src/a.mjs',range:'1-1'}},{claim:'거짓',source:{path:'other.mjs'}}],unresolved:[]}),calls:[]});
const model=replies=>async()=>replies.shift()||{content:'{"summary":"끝","findings":[],"unresolved":[]}',calls:[]};
const args={goal:'A 값 확인',scope:{paths:['src/']},budget:{calls:5,chars:24000}};
test('research uses original read schemas and accepts only findings with observed source ranges',async()=>{
 const seen=[],purposes=[];const replies=model([call('read_source',{path:'src/a.mjs'}),report()]);
 const a=createResearchAgent({readTools:[read],execute:async(n,a,s)=>{seen.push(n);assert.ok(s);return {path:a.path,content:'export const A=1',start:1,end:1,hash:'abc'};},invokeModel:async(w,t,s,p)=>{assert.deepEqual(t,[read]);purposes.push(p);return replies();}});
 const r=await a.delegate(args);assert.equal(r.calls,2);assert.equal(r.findings.length,1);assert.equal(r.findings[0].source.path,'src/a.mjs');assert.deepEqual(seen,['read_source']);assert.deepEqual(purposes,['research','research']);assert.ok(r.unresolved.length);
});
test('scope and schemas block writes, traversal, malformed args and unobserved findings before execution',async()=>{
 const seen=[];const a=createResearchAgent({readTools:[read],execute:async()=>seen.push('bad'),invokeModel:model([call('propose_patch',{}),call('read_source',{path:'src/../secret'}),call('read_source',{path:'src/a.mjs',start:'bad'}),report()])});
 const r=await a.delegate(args);assert.deepEqual(seen,[]);assert.deepEqual(r.findings,[]);assert.ok(r.unresolved.length>=3);
});
test('initial 20 calls and two continuations of 5 are bounded, with immutable scope and a lifetime admission count',async()=>{
 const a=createResearchAgent({readTools:[read],execute:async()=>({error:'source_missing'}),invokeModel:async()=>call('read_source',{path:'src/a.mjs'}),limit:{concurrent:2,perRun:1}});
 const r=await a.delegate({...args,budget:{calls:20}});assert.equal(r.calls,20);
 assert.equal((await a.continue({id:r.id,question:'더'})).calls,25);assert.equal((await a.continue({id:r.id,question:'더'})).calls,30);
 await assert.rejects(a.continue({id:r.id,question:'더'}),/research_continue_limit/);await assert.rejects(a.delegate(args),/research_limit/);
});
test('oversized results never exceed context cap or break tool/result JSON pairs',async()=>{
 let n=0;const a=createResearchAgent({readTools:[read],execute:async()=>({path:'src/a.mjs',content:'가'.repeat(50000),start:1,end:1}),invokeModel:async(w,t)=>{assert.ok(JSON.stringify({messages:w,tools:t}).length<=24000);for(const m of w.filter(x=>x.role==='tool'))JSON.parse(m.content);return ++n===1?call('read_source',{path:'src/a.mjs'}):report();}});
 const r=await a.delegate(args);assert.ok(r.unresolved.length);assert.equal(r.findings.length,0);
});
test('shared queue holds physical slots through cancellation and releases queued cancelled work',async()=>{
 const q=createWorkerScheduler(),c=new AbortController();let finish,started=0;
 const one=q.schedule(()=>new Promise(r=>{finish=r;started++;}));const two=q.schedule(()=>new Promise(r=>{c.signal.addEventListener('abort',r,{once:true});started++;}));
 const cancelled=q.schedule(()=>assert.fail('cancelled queued work ran'),c.signal);const rejected=assert.rejects(cancelled,/cancelled/);
 await new Promise(r=>setImmediate(r));assert.equal(started,2);c.abort();await rejected;finish();await Promise.all([one,two]);assert.equal(await q.schedule(()=>42),42);
 assert.equal(q.admit(6),true);assert.equal(q.admit(1),false);
});
test('analysts and researchers share cumulative admission while default coordinator remains reusable',async t=>{
 const q=createWorkerScheduler({concurrent:2,perRun:6});
 const coordinator=scheduler=>{const c=createAnalysisCoordinator({scheduler,signal:new AbortController().signal,run:runAgent,modelId:'fixture',complete:async()=>({content:'{"status":"partial","summary":"확인 중","findings":[],"uncertainties":["추가 확인"],"next_step":""}'})});t.after(()=>c.dispose());return c;};
 const c=coordinator(q),id=c.observe('read_page',{}, {text:'본문'});
 const assign=i=>({tasks:[{role:'page',task:'확인 '+i,done_when:'근거 확인',evidence_ids:[id]}]});
 for(let i=0;i<5;i++){assert.equal((await c.execute('delegate_analysis',assign(i))).ok,true);await c.collect();}
 const a=createResearchAgent({scheduler:q,readTools:[read],execute:async()=>({}),invokeModel:model([])});await a.delegate(args);
 assert.equal((await c.execute('delegate_analysis',assign(6))).error,'analysis_busy');await assert.rejects(a.delegate(args),/research_limit/);
 const d=coordinator();const eid=d.observe('read_page',{}, {text:'본문'});
 for(let i=0;i<7;i++){const input=assign(i);input.tasks[0].evidence_ids=[eid];assert.equal((await d.execute('delegate_analysis',input)).ok,true);await d.collect();}
});

test('null and scalar model reports are recoverable format failures',async()=>{
 for(const content of ['null','[]','true']){const a=createResearchAgent({readTools:[],execute:async()=>assert.fail(),invokeModel:async()=>({content,calls:[]})});const r=await a.delegate({goal:'확인',scope:{}});assert.ok(r.unresolved.some(s=>s.includes('JSON')));}
});
test('shared queue limits physical analyst and research lifetimes together to two',async t=>{
 const q=createWorkerScheduler();let active=0,peak=0;const holds=[];
 const hold=async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>holds.push(r));active--;};
 const c=createAnalysisCoordinator({scheduler:q,signal:new AbortController().signal,modelId:'fixture',run:runAgent,complete:async()=>{await hold();return {content:'{"status":"partial","summary":"확인 중","findings":[],"uncertainties":["추가 확인"],"next_step":""}'};}});t.after(()=>c.dispose());
 const id=c.observe('read_page',{}, {text:'본문'});await c.execute('delegate_analysis',{tasks:[{role:'page',task:'한도 확인',done_when:'확인',evidence_ids:[id]}]});
 const a=createResearchAgent({scheduler:q,readTools:[],execute:async()=>assert.fail(),invokeModel:async()=>{await hold();return {content:'{"summary":"끝","findings":[],"unresolved":[]}'};}});
 const r1=a.delegate({goal:'첫 조사',scope:{}}),r2=a.delegate({goal:'다음 조사',scope:{}});
 for(let i=0;i<100&&holds.length<2;i++)await new Promise(r=>setTimeout(r,5));assert.equal(active,2);assert.equal(holds.length,2);
 holds.shift()();for(let i=0;i<100&&holds.length<2;i++)await new Promise(r=>setTimeout(r,5));assert.equal(peak,2);while(holds.length)holds.shift()();await Promise.all([r1,r2,c.collect()]);
});

test('mail requires a searched id, wiki ranges require excerpts and disabled domains are not exposed',async()=>{
 const query=tool('personal_mail_query',{query:{type:'string'}},['query']),mail=tool('read_personal_mail',{id:{type:'string'},attachmentId:{type:'string'}},['id']),wiki=tool('wiki_query',{query:{type:'string'}},['query']);
 const seen=[];const replies=[call('read_personal_mail',{id:'invented'}),call('personal_mail_query',{query:'일정'}),call('read_personal_mail',{id:'m1',attachmentId:'a'}),call('read_personal_mail',{id:'m1'}),call('wiki_query',{query:'일정'}),{content:JSON.stringify({summary:'확인',findings:[{claim:'메일',source:{mailId:'m1'}},{claim:'위키',source:{wikiPage:'openwiki/home.md',range:'2-3'}},{claim:'범위 밖',source:{wikiPage:'openwiki/home.md',range:'1-4'}}],unresolved:[]})}];
 const a=createResearchAgent({readTools:[read,query,mail,wiki],invokeModel:async(w,t)=>{assert.ok(!t.some(x=>x.function.name==='read_source'));return replies.shift();},execute:async(n,args)=>{seen.push(n);return n==='personal_mail_query'?{results:[{id:'m1'}]}:n==='read_personal_mail'?{id:'m1',mail:{text:'본문'}}:{results:[{path:'openwiki/home.md',excerpt:'내용',provenance:{start:2,end:3}}]};}});
 const r=await a.delegate({goal:'일정 확인',scope:{mail:true,wiki:true},budget:{calls:8}});assert.equal(r.findings.length,2);assert.deepEqual(seen,['personal_mail_query','read_personal_mail','wiki_query']);
});
test('cancelled queued research never reaches the model, and a busy continuation cannot overlap',async()=>{
 const q=createWorkerScheduler({concurrent:1,perRun:6});let release;const busy=q.schedule(()=>new Promise(r=>{release=r;}));await new Promise(r=>setImmediate(r));
 const controller=new AbortController();const a=createResearchAgent({scheduler:q,signal:controller.signal,readTools:[],invokeModel:async()=>assert.fail('cancelled work reached model')});
 const pending=a.delegate({goal:'대기',scope:{}});const rejection=assert.rejects(pending,/cancelled/);controller.abort();await rejection;release();await busy;
 let finish;let n=0;const b=createResearchAgent({readTools:[],invokeModel:async()=>{if(++n===2)await new Promise(r=>{finish=r;});return {content:'{"summary":"끝","findings":[],"unresolved":[]}'};}});
 const r=await b.delegate({goal:'확인',scope:{}});const first=b.continue({id:r.id,question:'다시'});await new Promise(r=>setImmediate(r));await assert.rejects(b.continue({id:r.id,question:'동시'}),/research_busy/);finish();await first;
});

test('F6 read errors retain their code and normalized paths with missing scope roots isolated',async()=>{
 const seen=[],wire=[];let n=0;
 const a=createResearchAgent({readTools:[read],resolvePath:async p=>{if(p==='missing')throw Object.assign(Error('missing'),{code:'ENOENT'});return '/repo/'+p;},execute:async(name,args)=>{seen.push(args.path);throw Error('source_missing');},invokeModel:async messages=>{wire.push(...messages);return n++===0?call('read_source',{path:'./src/a.mjs'}):{content:'{"summary":"남은 확인","findings":[],"unresolved":[]}'};}});
 const r=await a.delegate({goal:'확인',scope:{paths:['src/','missing']}});assert.deepEqual(seen,['src/a.mjs']);assert(wire.some(m=>m.role==='tool'&&JSON.parse(m.content).error==='source_missing'));assert(r.unresolved.some(x=>x.includes('missing')));
});
test('F6 model failure records its recovery code in progress',async()=>{
 const progress=[];const a=createResearchAgent({readTools:[],execute:async()=>{},invokeModel:async()=>{throw Error('rate_limited');},onProgress:e=>progress.push(e)});
 await assert.rejects(a.delegate({goal:'확인',scope:{}}),/rate_limited/);assert.equal(progress.at(-1).error,'rate_limited');
});
test('F7 limits and invalid responses are not complete reports',async()=>{
 const a=createResearchAgent({readTools:[read],execute:async()=>({path:'src/a.mjs',content:'a',start:1,end:1}),invokeModel:async()=>call('read_source',{path:'src/a.mjs'})});
 const r=await a.delegate({...args,budget:{calls:1}});assert.equal(r.status,'budget_exhausted');assert.match(r.summary,/1/);
 const b=createResearchAgent({readRoom:1000,readTools:[],invokeModel:async()=>assert.fail('context-overflow call')});assert.equal((await b.delegate({goal:'가'.repeat(2000),scope:{},budget:{chars:4000}})).status,'context_limit');
 const c=createResearchAgent({readTools:[],invokeModel:async()=>({content:'null'})});assert.equal((await c.delegate({goal:'확인',scope:{}})).status,'partial');
});
test('F10 cancelled queued research refunds only its unused admission',async()=>{
 const q=createWorkerScheduler({concurrent:1,perRun:1});let release;const hold=q.schedule(()=>new Promise(r=>release=r));await new Promise(r=>setImmediate(r));
 const controller=new AbortController(),a=createResearchAgent({scheduler:q,signal:controller.signal,readTools:[],invokeModel:async()=>assert.fail()});
 const cancelled=a.delegate({goal:'대기',scope:{}}),rejected=assert.rejects(cancelled,/cancelled/);controller.abort();await rejected;assert.equal(q.admit(),true);assert.equal(q.admit(),false);release();await hold;
});
test('F6 project-wide search accepts omitted within while a narrow scope requires it',async()=>{
 const search=tool('source_search',{query:{type:'string'},within:{type:'string'}},['query']);
 for(const paths of [['.'],['src']]){
  const seen=[],messages=[];let n=0;const a=createResearchAgent({readTools:[search],execute:async(name,args)=>{seen.push(args);return {results:[]};},invokeModel:async wire=>{messages.push(...wire);return n++===0?call('source_search',{query:'name'}):report();}});
  const r=await a.delegate({goal:'찾기',scope:{paths}});
  if(paths[0]==='.')assert.equal(seen[0].within,'.');else{assert.equal(seen.length,0);assert(r.unresolved.some(x=>x.includes('within')));assert(messages.some(m=>m.role==='tool'&&JSON.parse(m.content).error==='research_scope'));}
 }
});
