import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWorkbookContext,workbookTools} from '../worker/workbook-context.mjs';
import {createActivityLog} from '../worker/activity.mjs';
import {startAgent} from '../worker/agent.mjs';
import {call,text,workbook,contract,scriptedProvider,drive,planCall,valueEdit} from './harness-fixtures.mjs';

// Controlled model replies and detached worksheet data. No Excel COM or real
// Qwen execution takes place in these tests.
const analysis=messages=>{const {goal,sources}=JSON.parse(messages[1].content);return text(JSON.stringify({summary:goal,findings:[{text:'관찰한 입력값을 확인했습니다.',sources:[{snapshotId:sources[0].snapshotId,address:'A1'}]}],missing:[]}));};
function setup(complete=async messages=>analysis(messages)){
  const book=workbook(),scope=book.snapshot(),controller=new AbortController(),activity=createActivityLog(),metrics={modelCalls:0,usage:[]},calls=[];
  const sheets={scores:{name:'성적 입력',values:[[80,90]]},criteria:{name:'등급 기준',values:[[90,80]]}};
  async function host(name,{payload={}}={}){
    calls.push({name,payload:structuredClone(payload)});
    if(name==='workbook_sheets')return{kind:'worksheet_catalog',documentId:scope.documentId,sourceScopeId:scope.scopeId,items:Object.entries(sheets).map(([sheetId,s])=>({sheetId,name:s.name})),offset:0,total:2,nextOffset:null};
    if(name==='workbook_structure')return{kind:'worksheet_structure',documentId:scope.documentId,sourceScopeId:scope.scopeId,sheetId:payload.sheetId,part:payload.part,items:[{name:'성적표',address:'A1:B1'}],nextOffset:null};
    if(name==='workbook_range'){
      const sheet=sheets[payload.sheetId];if(!sheet)return{error:'out_of_scope'};
      const snapshot={...scope,kind:'workbook_range',readOnly:true,sourceScopeId:scope.scopeId,sheetId:payload.sheetId,worksheet:sheet.name,address:'A1:B1',values:structuredClone(sheet.values)};delete snapshot.scopeId;
      snapshot.fingerprint=createHash('sha256').update(JSON.stringify([sheet.name,sheet.values])).digest('hex');return snapshot;
    }
    throw new Error('unexpected_host_call');
  }
  const providers={status:()=>({provider:'aipro',model:'scripted-qwen-fixture'}),complete};
  const context=createWorkbookContext({scope,host,providers,signal:controller.signal,activity,metrics,analysisTimeoutMs:40});
  return{context,book,scope,sheets,host,calls,providers,controller,activity,metrics};
}
async function capture(h){await h.context.execute('list_worksheets');const refs=[];for(const sheetId of ['scores','criteria'])refs.push(await h.context.execute('read_worksheet_range',{sheetId,address:'A1:B1'}));return refs;}
test('observed progress changes for new metadata and analysis, not repeated reads or cached reports',async()=>{
  const h=setup(),initial=h.context.progress();
  const [a]=await capture(h),captured=structuredClone(h.context.progress());
  assert.notDeepEqual(captured,initial);
  await h.context.refresh();assert.deepEqual(h.context.progress(),captured);
  const tasks=[{goal:'성적 분석',snapshotIds:[a.snapshotId]}];
  await h.context.execute('analyze_ranges',{tasks});const analyzed=structuredClone(h.context.progress());
  assert.notDeepEqual(analyzed,captured);
  await h.context.execute('analyze_ranges',{tasks});assert.deepEqual(h.context.progress(),analyzed);
  h.sheets.scores.values[0][0]=81;await h.context.refresh();assert.notDeepEqual(h.context.progress(),analyzed);
});
test('workbook metadata and range references retain exact values without granting a write scope',async()=>{
  const h=setup(),[a,b]=await capture(h);
  assert.equal(h.context.dependencies().length,2);assert.equal(h.book.writes,0);
  assert.equal('values' in a,false);assert.equal('scopeId' in a,false);
  const data=await h.context.execute('get_range_data',{snapshotId:a.snapshotId,address:'B1'});assert.deepEqual(data.values,[[90]]);
  assert.deepEqual(h.context.evidence().map(s=>s.worksheet),['성적 입력','등급 기준']);
  const capabilities=await h.context.execute('excel_capabilities');assert.equal(capabilities.platform,'Windows Excel 2016');assert.ok(capabilities.capabilities.some(c=>c.status==='not_implemented'));
  assert.equal(h.context.has('apply_changes'),false);assert.equal(workbookTools.some(t=>t.function.name==='execute_vba'),false);
});
test('undiscovered sheets, forged workbook receipts and incorrect read coverage are rejected',async()=>{
  const h=setup();await assert.rejects(h.context.execute('read_worksheet_range',{sheetId:'foreign',address:'A1'}),/worksheet_not_discovered/);
  await h.context.execute('list_worksheets');await assert.rejects(h.context.execute('read_worksheet_range',{sheetId:'scores',address:'A1'}),/observation_invalid/);
  const forged=createWorkbookContext({...h,signal:h.controller.signal,host:async()=>({sourceScopeId:'another',documentId:h.scope.documentId,items:[]})});
  await assert.rejects(forged.execute('list_worksheets'),/observation_invalid/);
});
test('exact data retrieval rejects out-of-snapshot and oversized ranges',async()=>{
  const h=setup(),[a]=await capture(h);
  await assert.rejects(h.context.execute('get_range_data',{snapshotId:a.snapshotId,address:'C1'}),/context_range_limit/);
  await assert.rejects(h.context.execute('get_range_data',{snapshotId:'invented',address:'A1'}),/source_not_read/);
  await assert.rejects(h.context.execute('read_worksheet_range',{sheetId:'scores',address:'A1:XFD1048576'}),/invalid_range/);
});
test('independent analysis uses isolated data, at most two model calls and no write tools',async()=>{
  let active=0,peak=0;
  const h=setup(async(messages,tools)=>{assert.deepEqual(tools,[]);assert.match(messages[0].content,/Excel 2016/);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;assert.equal(JSON.parse(messages[1].content).sources.length,1);return analysis(messages);});
  const refs=await capture(h),tasks=Array.from({length:4},(_,i)=>({goal:`분석 ${i}`,snapshotIds:[refs[i%2].snapshotId]}));
  const result=await h.context.execute('analyze_ranges',{tasks});assert.equal(result.status,'analyzed');assert.equal(peak,2);assert.equal(h.metrics.subagentCalls,4);
  assert.equal(h.activity.snapshot().filter(e=>e.kind==='subagent'&&e.state==='done').length,4);
  await h.context.execute('analyze_ranges',{tasks});assert.equal(h.metrics.subagentCalls,4,'verified-format results reused without another inference');
});
test('a failed branch preserves successful analysis and retries only the missing result',async()=>{
  const counts={};const h=setup(async messages=>{const goal=JSON.parse(messages[1].content).goal;counts[goal]=(counts[goal]||0)+1;if(goal==='기준 분석'&&counts[goal]===1)throw new Error('upstream');return analysis(messages);});
  const refs=await capture(h),tasks=refs.map((r,i)=>({goal:i?'기준 분석':'성적 분석',snapshotIds:[r.snapshotId]}));
  const first=await h.context.execute('analyze_ranges',{tasks});assert.equal(first.status,'incomplete');
  const second=await h.context.execute('analyze_ranges',{tasks});assert.equal(second.status,'analyzed');assert.deepEqual(counts,{'성적 분석':1,'기준 분석':2});
});
test('a subagent cannot fabricate source IDs or addresses to pass evidence validation',async()=>{
  const h=setup(async()=>text(JSON.stringify({summary:'결과',findings:[{text:'완료',sources:[{snapshotId:'invented',address:'Z99'}]}],missing:[]})));
  const [a]=await capture(h);const result=await h.context.execute('analyze_ranges',{tasks:[{goal:'성적 분석',snapshotIds:[a.snapshotId]}]});
  assert.equal(result.status,'incomplete');assert.equal(result.results[0].error,'analysis_invalid');assert.equal(h.context.context().analyses.length,0);
});
test('source edits invalidate old references and summaries on refresh',async()=>{
  const h=setup(),[a]=await capture(h);await h.context.execute('analyze_ranges',{tasks:[{goal:'성적 분석',snapshotIds:[a.snapshotId]}]});
  h.sheets.scores.values[0][0]=88;await h.context.refresh();assert.equal(h.context.context().analyses.length,0);
  assert.equal(h.context.evidence()[1].values[0][0],88);
  await assert.rejects(h.context.execute('get_range_data',{snapshotId:a.snapshotId,address:'A1'}),/source_not_read/);
});
test('source rename updates captured names even if the host fingerprint stays constant',async()=>{
  const h=setup();let fixedFingerprint;
  const context=createWorkbookContext({...h,signal:h.controller.signal,host:async(...args)=>{const result=await h.host(...args);if(args[0]==='workbook_range'){fixedFingerprint??=result.fingerprint;result.fingerprint=fixedFingerprint;}return result;}});
  h.context=context;await capture(h);h.sheets.scores.name='이름 변경';await h.context.refresh();assert.equal(h.context.evidence().some(s=>s.worksheet==='이름 변경'),true);
});
test('requested formatting details survive compaction and are available to the reviewer',async()=>{
  const h=setup(),[a]=await capture(h),tasks=[{goal:'서식 확인',snapshotIds:[a.snapshotId]}];
  await h.context.execute('analyze_ranges',{tasks});await h.context.execute('get_range_data',{snapshotId:a.snapshotId,address:'A1'});
  const detail=h.context.evidence()[0].details[0];assert.deepEqual(detail.formats.fontName,[['맑은 고딕']]);
  assert.equal(h.context.context().ranges[0].snapshotId,a.snapshotId);
  await h.context.execute('analyze_ranges',{tasks});assert.equal(h.metrics.subagentCalls,2,'new formatting evidence must invalidate a prior limited analysis');
});
test('rate limiting drains no additional queued requests and reduces the next analysis to serial',async()=>{
  let requests=0;
  const h=setup(async messages=>{const request=++requests;if(request<=2)await new Promise(resolve=>setImmediate(resolve));if(request===1)throw Object.assign(new Error('rate_limited'),{status:429,retryAfterMs:12000});return analysis(messages);});
  const [a]=await capture(h),tasks=Array.from({length:4},(_,i)=>({goal:`분석 ${i}`,snapshotIds:[a.snapshotId]}));
  const first=await h.context.execute('analyze_ranges',{tasks});assert.equal(first.status,'incomplete');assert.equal(requests,2);assert.equal(first.retryAfterMs,12000);assert.ok(first.results.filter(r=>r.status==='failed').every(r=>r.retryAfterMs===12000));
  const second=await h.context.execute('analyze_ranges',{tasks});assert.equal(second.concurrency,1);assert.equal(second.status,'analyzed');assert.equal(requests,5);assert.equal(h.metrics.context.rateLimitFallbacks,1);
});
test('permanent connection failures surface immediately instead of an automatic analysis retry loop',async()=>{
  const h=setup(async()=>{throw new Error('tls_untrusted');}),[a]=await capture(h);
  await assert.rejects(h.context.execute('analyze_ranges',{tasks:[{goal:'성적 분석',snapshotIds:[a.snapshotId]}]}),/tls_untrusted/);
  assert.equal(h.metrics.subagentCalls,1);
});
test('cancellation aborts every running analysis and never starts queued work',{timeout:1000},async()=>{
  let started=0,aborted=0,ready;const running=new Promise(resolve=>{ready=resolve;});
  const h=setup(async(_m,_t,signal)=>new Promise((resolve,reject)=>{started++;signal.addEventListener('abort',()=>{aborted++;reject(new Error('cancelled'));},{once:true});if(started===2)ready();}));
  const [a]=await capture(h);const pending=h.context.execute('analyze_ranges',{tasks:Array.from({length:4},(_,i)=>({goal:`분석 ${i}`,snapshotIds:[a.snapshotId]}))});
  const rejection=assert.rejects(pending,/cancelled/);await running;h.controller.abort();await rejection;assert.equal(started,2);assert.equal(aborted,2);assert.equal(h.book.writes,0);
});
test('cancelling before the scheduler starts dispatches no analysis request',async()=>{
  let started=0;const h=setup(async messages=>{started++;return analysis(messages);}),[a]=await capture(h);
  const pending=h.context.execute('analyze_ranges',{tasks:[{goal:'분석',snapshotIds:[a.snapshotId]}]});
  h.controller.abort();await assert.rejects(pending,/cancelled/);assert.equal(started,0);
});
test('a non-responsive analysis returns a visible failure instead of blocking forever',async()=>{
  const h=setup(async()=>new Promise(()=>{})),[a]=await capture(h);
  const result=await h.context.execute('analyze_ranges',{tasks:[{goal:'응답 대기',snapshotIds:[a.snapshotId]}]});assert.equal(result.status,'incomplete');assert.equal(result.results[0].error,'model_timeout');
});
test('real Pi cell agent routes multi-sheet tools and supplies raw fresh sources to final review',async()=>{
  const h=setup(),documentSkill={id:'00000000-0000-4000-8000-000000000001',host:'excel',revision:1,name:'검토 규칙',instructions:'금액은 천 원 단위로 검토한다.',questions:[]};let reviewed=false;
  const base=scriptedProvider({task:contract([],{intent:'analyze'}),actor:[call('list_worksheets'),call('read_worksheet_range',{sheetId:'scores',address:'A1:B1'}),call('read_worksheet_range',{sheetId:'criteria',address:'A1:B1'}),call('analyze_ranges',{tasks:[{goal:'성적 확인',snapshotIds:['range-1']},{goal:'기준 확인',snapshotIds:['range-2']}]}),text('성적 입력과 등급 기준을 읽었습니다.')],resultReview:payload=>{
    const evidence=payload.evidence.find(e=>e.tool==='workbook_readback');assert.equal(evidence.result.sources.length,2);assert.deepEqual(evidence.result.sources[0].values,[[80,90]]);reviewed=true;
    return text(JSON.stringify({status:'complete',checks:[{requirement:'시트 비교',status:'met',evidence_ids:[evidence.id]}],next_step:''}));
  }});
  const providers={...h.providers,complete:(messages,...rest)=>messages[0].content.startsWith('NUBI_EXCEL_2016_ANALYST')?(()=>{const parent=JSON.parse(messages.at(-1).content);assert.equal(parent.kind,'parent_task_context');assert.ok(parent.activeSkills[0].instructions.includes(documentSkill.instructions));assert.equal(parent.activeSkills[0].revision,1);assert.equal(parent.request,'성적 입력과 등급 기준 시트를 비교해줘');assert.deepEqual(parent.requirements,contract([],{intent:'analyze'}).requirements);return h.providers.complete(messages,...rest);})():base.complete(messages,...rest)};
  const run=startAgent({request:'성적 입력과 등급 기준 시트를 비교해줘',documentSkill,scope:h.scope,mode:'analyze',providers,resilienceOptions:{wait:async()=>{}}});
  const state=await drive(run,action=>action.name.startsWith('workbook_')?h.host(action.name,action):h.book.action(action));
  assert.equal(state.state,'done',state.error);assert.equal(reviewed,true);assert.equal(state.metrics.subagentCalls,2);assert.equal(state.workbookSources.length,2);assert.equal(h.book.writes,0);
});
test('edit payload pins source fingerprints and never grants another sheet a mutation scope',async()=>{
  const h=setup(),base=scriptedProvider({actor:[call('list_worksheets'),call('read_worksheet_range',{sheetId:'criteria',address:'A1:B1'}),planCall([valueEdit(42)]),text('선택 셀을 반영했습니다.')]});
  const run=startAgent({request:'기준 시트를 참고하고 선택한 A1을 42로 바꿔줘',scope:h.scope,mode:'edit',providers:base,resilienceOptions:{wait:async()=>{}}});
  let pinned=false;const state=await drive(run,action=>{if(action.name.startsWith('workbook_'))return h.host(action.name,action);if(action.name==='apply_changes'){assert.equal(action.scopeId,h.scope.scopeId);assert.equal(action.plan.sourceDependencies.length,1);assert.equal(action.plan.sourceDependencies[0].sheetId,'criteria');pinned=true;}return h.book.action(action);});
  assert.equal(state.state,'done',state.error);assert.equal(pinned,true);assert.equal(h.book.writes,1);
});

test('Excel role briefs and citations survive context reconstruction and bind result reuse',async()=>{
  const h=setup(),refs=await capture(h),task={goal:'조건 점검',snapshotIds:refs.map(r=>r.snapshotId),role:'review',constraints:'수식 보존',doneWhen:'근거 셀과 누락 정보 확인'};
  await h.context.execute('analyze_ranges',{tasks:[task]});const retained=h.context.context().analyses[0];assert.equal(retained.constraints,'수식 보존');assert.equal(retained.advisory,true);assert.equal(retained.findings[0].sources[0].address,'A1');
  await h.context.execute('analyze_ranges',{tasks:[{...task,snapshotIds:task.snapshotIds.toReversed()}]});assert.equal(h.metrics.subagentCalls,1);
  await h.context.execute('analyze_ranges',{tasks:[{...task,constraints:'값과 수식 보존'}]});assert.equal(h.metrics.subagentCalls,2);
});
