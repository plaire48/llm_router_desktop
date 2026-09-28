import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWorkbookContext} from '../worker/workbook-context.mjs';
import {createActivityLog} from '../worker/activity.mjs';
import {text,workbook} from './harness-fixtures.mjs';

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
  const workers=[],parent={request:'수능 성적표 분석',requirements:['입력과 등급 기준 확인'],answers:[]};
  const context=createWorkbookContext({scope,host,providers,signal:controller.signal,activity,metrics,analysisTimeoutMs:1000,onWorkers:nodes=>workers.push(structuredClone(nodes)),getTaskContext:()=>parent});
  return{context,book,scope,sheets,host,calls,providers,controller,activity,metrics,workers,parent};
}
async function capture(h){await h.context.execute('list_worksheets');const refs=[];for(const sheetId of ['scores','criteria'])refs.push(await h.context.execute('read_worksheet_range',{sheetId,address:'A1:B1'}));return refs;}
const task=(id,snapshotIds,dependsOn=[])=>({id,specialty:`${id} 담당`,goal:`${id} 검사`,role:'analysis',constraints:'원본 자료만 사용',doneWhen:'근거 셀을 인용한다',snapshotIds,dependsOn});
test('Excel dynamic specialists parallelize independently and merge with native source guards and exact cell evidence',async()=>{
  let active=0,peak=0;const packets=[];
  const h=setup(async(messages,tools)=>{assert.deepEqual(tools,[]);assert.equal(h.calls.filter(c=>c.name==='workbook_range').length>=4,true);active++;peak=Math.max(peak,active);packets.push(messages);await new Promise(r=>setTimeout(r,3));active--;return analysis(messages);});
  const [a,b]=await capture(h),tasks=[task('scores',[a.snapshotId]),task('criteria',[b.snapshotId]),task('merge',[a.snapshotId,b.snapshotId],['scores','criteria'])];
  const result=await h.context.execute('delegate_range_tasks',{tasks});
  assert.equal(result.status,'analyzed');assert.equal(peak,2);assert.equal(h.book.writes,0);assert.equal(h.metrics.subagentCalls,3);
  const merge=packets.find(m=>JSON.parse(m[1].content).goal==='merge 검사'),deps=JSON.parse(merge.find(m=>m.content.includes('advisory_predecessor_reports')).content);
  assert.equal(deps.dependencies.length,2);assert.equal(deps.dependencies.find(d=>d.id==='scores').findings[0].sources[0].snapshotId,a.snapshotId);
  assert.ok(JSON.parse(merge[1].content).sources.every(s=>Array.isArray(s.values)&&Array.isArray(s.formulas)));
  assert.deepEqual(h.workers.at(-1).map(n=>n.state),['done','done','done']);assert.equal(h.context.progress().delegation,3);assert.equal(h.context.progress().analyses,0);assert.deepEqual(h.context.context().analyses,[]);
  await h.context.execute('delegate_range_tasks',{tasks});assert.equal(h.metrics.subagentCalls,3);
  const renamed=tasks.map(t=>({...t,id:`new_${t.id}`,dependsOn:t.dependsOn.map(id=>`new_${id}`)})).reverse();await h.context.execute('delegate_range_tasks',{tasks:renamed});assert.equal(h.context.progress().delegation,3);
});
test('Excel DAG rejects cycles, outside ranges and duplicate semantic tasks before model dispatch',async()=>{
  const h=setup(),[a]=await capture(h);const before=h.calls.length;
  await assert.rejects(h.context.execute('delegate_range_tasks',{tasks:[task('a',[a.snapshotId],['b']),task('b',[a.snapshotId],['a'])]}),/tool_arguments_invalid/);
  await assert.rejects(h.context.execute('delegate_range_tasks',{tasks:[task('a',['forged'])]}),/source_not_read/);
  await assert.rejects(h.context.execute('delegate_range_tasks',{tasks:[task('a',[a.snapshotId]),{...task('a',[a.snapshotId]),id:'b'}]}),/tool_arguments_invalid/);
  assert.equal(h.calls.length,before);assert.equal(h.metrics.subagentCalls,undefined);
});
test('Excel partial results block dependent work and remain missing through compact context and read-only result retrieval',async()=>{
  const h=setup(async messages=>{const p=JSON.parse(messages[1].content);if(p.goal==='budget 검사')return text(JSON.stringify({summary:'예산 확인 필요',findings:[],missing:['예산 상한이 미정입니다.']}));return analysis(messages);});
  const [a]=await capture(h),tasks=[task('budget',[a.snapshotId]),task('merge',[a.snapshotId],['budget']),...Array.from({length:6},(_,i)=>task(`parallel${i}`,[a.snapshotId]))];
  const result=await h.context.execute('delegate_range_tasks',{tasks});assert.equal(result.status,'incomplete');assert.equal(result.results[1].status,'blocked');assert.equal(h.metrics.subagentCalls,7);assert.equal(h.context.progress().delegation,6);
  const context=h.context.context().delegation[0];assert.equal(context.nodes.length,8);assert.ok(context.omittedTaskIds.includes('budget'));assert.deepEqual(context.nodes[0].missing,['예산 상한이 미정입니다.']);
  const saved=await h.context.execute('read_delegation_results',{planId:context.planId,taskIds:['budget','merge']});assert.deepEqual(saved.tasks[0].task,tasks[0]);assert.deepEqual(saved.tasks[0].result.missing,['예산 상한이 미정입니다.']);assert.equal(saved.tasks[1].state,'blocked');assert.equal(h.metrics.subagentCalls,7);
  await h.context.execute('delegate_range_tasks',{tasks});assert.equal(h.metrics.subagentCalls,7,'missing input must not cause speculative re-analysis');
});
test('Excel source drift during a child result rejects all evidence and never dispatches dependent models',async()=>{
  const h=setup(async messages=>{h.sheets.scores.values[0][0]=33;return analysis(messages);});const [a]=await capture(h);
  await assert.rejects(h.context.execute('delegate_range_tasks',{tasks:[task('a',[a.snapshotId]),task('b',[a.snapshotId],['a'])]}),/source_changed/);
  assert.equal(h.metrics.subagentCalls,1);assert.equal(h.context.progress().delegation,0);assert.deepEqual(h.context.context().delegation,[]);assert.equal(h.book.writes,0);
});
test('Excel retry preserves accepted siblings after both transient and permanent model failures',async()=>{
  for(const permanent of [false,true]){
    let failed=true;const counts={};const h=setup(async messages=>{const p=JSON.parse(messages[1].content);counts[p.goal]=(counts[p.goal]??0)+1;await new Promise(r=>setImmediate(r));if(p.goal==='bad 검사'&&failed)throw Object.assign(new Error(permanent?'unauthorized':'upstream'),{status:permanent?401:503});return analysis(messages);});const [a]=await capture(h),tasks=[task('bad',[a.snapshotId]),task('good',[a.snapshotId]),task('merge',[a.snapshotId],['bad','good'])];
    if(permanent)await assert.rejects(h.context.execute('delegate_range_tasks',{tasks}),/unauthorized/);else assert.equal((await h.context.execute('delegate_range_tasks',{tasks})).status,'incomplete');
    assert.equal(h.context.progress().delegation,1);assert.equal(h.context.context().delegation[0].results.some(r=>r.id==='good'),true);
    failed=false;assert.equal((await h.context.execute('delegate_range_tasks',{tasks})).status,'analyzed');assert.deepEqual(counts,{'bad 검사':2,'good 검사':1,'merge 검사':1});
  }
});
test('Excel answers, provider model and native changes invalidate delegated result retrieval',async()=>{
  for(const change of ['answers','model','source']){
    const h=setup(),[a]=await capture(h),result=await h.context.execute('delegate_range_tasks',{tasks:[task('a',[a.snapshotId])]});
    if(change==='answers')h.parent.requirements.push('추가 등급 조건');if(change==='model')h.providers.status=()=>({provider:'aipro',model:'different'});if(change==='source')h.sheets.scores.values[0][0]=55;
    await assert.rejects(h.context.execute('read_delegation_results',{planId:result.planId,taskIds:['a']}),/analysis_invalid|source_changed/);assert.equal(h.metrics.subagentCalls,1);assert.deepEqual(h.context.context().delegation,[]);
  }
});
test('Excel rate-limit failure waits for the parent and does not dispatch remaining dependency batches',async()=>{
  let calls=0;const h=setup(async messages=>{const n=++calls;await new Promise(r=>setImmediate(r));if(n===1)throw Object.assign(new Error('rate_limited'),{status:429,retryAfterMs:5000});return analysis(messages);});const [a]=await capture(h);
  const result=await h.context.execute('delegate_range_tasks',{tasks:Array.from({length:6},(_,i)=>task(`a${i}`,[a.snapshotId]))});assert.equal(result.retryAfterMs,5000);assert.equal(calls,2);assert.equal(result.status,'incomplete');
});
test('Excel cancellation never accepts late child evidence or starts dependent work',async()=>{
  let begun;const started=new Promise(r=>begun=r);const h=setup(async messages=>{begun();await new Promise(r=>setTimeout(r,15));return analysis(messages);});const [a]=await capture(h);
  const result=h.context.execute('delegate_range_tasks',{tasks:[task('a',[a.snapshotId]),task('b',[a.snapshotId],['a'])]});await started;h.controller.abort();await assert.rejects(result,/cancelled/);assert.equal(h.context.progress().delegation,0);assert.equal(h.metrics.subagentCalls,1);assert.equal(h.book.writes,0);
});
test('reading captured cell details does not invalidate a retained delegation source binding',async()=>{
  const h=setup(),[a]=await capture(h),result=await h.context.execute('delegate_range_tasks',{tasks:[task('a',[a.snapshotId])]});
  await h.context.execute('get_range_data',{snapshotId:a.snapshotId,address:'A1'});
  const saved=await h.context.execute('read_delegation_results',{planId:result.planId,taskIds:['a']});assert.equal(saved.tasks[0].result.reportStatus,'complete');assert.equal(h.metrics.subagentCalls,1);assert.equal(h.context.progress().delegation,1);
});
