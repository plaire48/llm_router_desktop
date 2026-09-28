// Real Pi orchestration with explicit fake provider/native inputs, not model
// quality or Office COM evidence. No automatic approval of real work occurs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {startAgent} from '../worker/agent.mjs';
import {workbook,scriptedProvider,contract,call,text,drive} from './harness-fixtures.mjs';

const tasks=[
  {id:'scores',specialty:'성적 분석',snapshotIds:['range-1'],dependsOn:[]},
  {id:'criteria',specialty:'등급 기준 검토',snapshotIds:['range-2'],dependsOn:[]},
  {id:'combine',specialty:'결과 통합',snapshotIds:['range-1','range-2'],dependsOn:['scores','criteria']}
].map(t=>({...t,goal:t.specialty,role:'review',constraints:'원본 값과 수식을 보존한다',doneWhen:'관찰한 셀을 인용하고 미확인을 구분한다'}));
const reads=()=>[call('list_worksheets'),call('read_worksheet_range',{sheetId:'scores',address:'A1:B1'}),call('read_worksheet_range',{sheetId:'criteria',address:'A1:B1'})];
function fixture({actor,child,wait=async()=>{},continuousInput=false}={}){
  const book=workbook(),scope=book.snapshot(),actions=[],calls=[],snapshots=[];
  const sheets={scores:{name:'성적 입력',values:[[80,90]]},criteria:{name:'등급 기준',values:[[90,80]]}};
  let active=0,peak=0;
  const base=scriptedProvider({task:contract([],{intent:'analyze'}),actor:actor||[...reads(),call('delegate_range_tasks',{tasks}),text('성적과 기준 검토 결과입니다.')]});
  const providers={status:()=>({provider:'aipro',model:'selected-qwen-fixture'}),async complete(messages,tools,...rest){
    if(messages[0].content.startsWith('NUBI_EXCEL_2016_ANALYST')){
      assert.deepEqual(tools,[]);const payload=JSON.parse(messages[1].content),parent=JSON.parse(messages.at(-1).content);
      assert.equal(parent.request,'성적 입력과 등급 기준을 역할별로 비교해줘');calls.push(payload.specialty);active++;peak=Math.max(peak,active);
      try{await new Promise(r=>setTimeout(r,2));return child?await child(payload,messages):text(JSON.stringify({summary:payload.specialty,findings:[{text:'할당한 범위 확인',sources:[{snapshotId:payload.sources[0].snapshotId,address:'A1'}]}],missing:[]}));}finally{active--;}
    }
    if(tools?.length){assert.ok(tools.some(t=>t.function.name==='delegate_range_tasks'));assert.ok(tools.some(t=>t.function.name==='read_delegation_results'));}
    return base.complete(messages,tools,...rest);
  }};
  const run=startAgent({request:'성적 입력과 등급 기준을 역할별로 비교해줘',scope,mode:'analyze',providers,continuousInput,resilienceOptions:{wait}});
  function native(action){
    assert.equal(active,0,'native reads must wait for model batch settlement');actions.push(action);snapshots.push(run.status());
    const args=action.payload||{};
    if(action.name==='workbook_sheets')return{kind:'worksheet_catalog',documentId:scope.documentId,sourceScopeId:scope.scopeId,items:Object.entries(sheets).map(([sheetId,s])=>({sheetId,name:s.name})),offset:0,total:2,nextOffset:null};
    if(action.name==='workbook_range'){
      const s=sheets[args.sheetId],snapshot={...scope,kind:'workbook_range',readOnly:true,sourceScopeId:scope.scopeId,sheetId:args.sheetId,worksheet:s.name,address:'A1:B1',values:structuredClone(s.values)};delete snapshot.scopeId;
      snapshot.fingerprint=createHash('sha256').update(JSON.stringify([s.name,s.values])).digest('hex');return snapshot;
    }
    return book.action(action);
  }
  return{run,native,book,calls,actions,snapshots,get peak(){return peak;}};
}
const report=p=>text(JSON.stringify({summary:p.specialty,findings:[{text:'입력값 확인',sources:[{snapshotId:p.sources[0].snapshotId,address:'A1'}]}],missing:[]}));

test('Excel parent selects specialist roles, executes dependencies and retains read-only bounds',async()=>{
  let mergeSeen=false;
  const h=fixture({child:(p,messages)=>{
    if(p.specialty==='결과 통합'){
      const predecessors=messages.map(m=>{try{return JSON.parse(m.content);}catch{return{};}}).find(m=>m.kind==='advisory_predecessor_reports');
      assert.equal(predecessors.dependencies.length,2);assert.ok(predecessors.dependencies.every(r=>r.reportStatus==='complete'));mergeSeen=true;
    }
    return report(p);
  }});
  const done=await drive(h.run,h.native);assert.equal(done.state,'done',done.error);assert.equal(mergeSeen,true);assert.equal(h.peak,2);assert.deepEqual(h.calls,['성적 분석','등급 기준 검토','결과 통합']);
  assert.equal(done.delegationWorkers.nodes.length,3);assert.ok(done.delegationWorkers.nodes.every(n=>n.state==='done'));assert.equal(h.book.writes,0);assert.equal(done.metrics.subagentCalls,3);
});

test('Excel partial analysis blocks integration and waits for user input in the same run',async()=>{
  const h=fixture({continuousInput:true,actor:[...reads(),call('delegate_range_tasks',{tasks}),call('ask_user',{question:'등급 기준 연도는 언제인가요?'})],child:p=>p.specialty==='등급 기준 검토'?text(JSON.stringify({summary:'기준 연도 미확인',findings:[],missing:['등급 기준 연도']})):report(p)});
  let waiting;
  for(let i=0;i<1000;i++){
    const s=h.run.status();if(s.state!=='running')assert.fail(s.error||s.state);
    if(s.action?.name==='request_input'){waiting=s;break;}
    if(s.action)h.run.respond(s.action.callId,s.action.name==='show_plan'?{displayed:true}:h.native(s.action));
    await new Promise(r=>setTimeout(r,1));
  }
  assert.ok(waiting);assert.equal(waiting.id,h.run.id);assert.deepEqual(h.calls,['성적 분석','등급 기준 검토']);assert.equal(waiting.metrics.recoveryCalls,0);
  assert.equal(waiting.delegationWorkers.nodes.find(n=>n.taskId==='criteria').state,'waiting');assert.equal(waiting.delegationWorkers.nodes.find(n=>n.taskId==='combine').state,'blocked');
  h.run.cancel();await h.run.promise;assert.equal(h.run.status().state,'cancelled');assert.equal(h.book.writes,0);
});

test('Excel parent honors Retry-After and only retries the failed specialist',async()=>{
  const counts={},waits=[];
  const h=fixture({actor:[...reads(),call('delegate_range_tasks',{tasks}),call('delegate_range_tasks',{tasks}),text('검토 결과를 확인했습니다.')],wait:async ms=>waits.push(ms),child:p=>{
    counts[p.specialty]=(counts[p.specialty]||0)+1;
    if(p.specialty==='등급 기준 검토'&&counts[p.specialty]===1)throw Object.assign(new Error('rate_limited'),{status:429,retryAfterMs:1900});return report(p);
  }});
  const done=await drive(h.run,h.native);assert.equal(done.state,'done',done.error);assert.deepEqual(counts,{'성적 분석':1,'등급 기준 검토':2,'결과 통합':1});assert.ok(waits.some(ms=>ms>=1900));assert.equal(h.book.writes,0);assert.equal(done.metrics.recoveryCalls,1);
});
