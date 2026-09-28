import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {activityView,taskView,reviewWorkerView} from '../src/task-view.js';

test('terminal session status fences unfinished tool events without inventing completion',()=>{
  for(const state of ['done','failed','cancelled','unsupported'])for(const toolState of ['running','waiting']){
    const event={kind:'tool',state:toolState,startedAt:100};
    assert.deepEqual(activityView(event,{state},undefined,10000),{status:'unconfirmed',label:'결과 미확인',seconds:null});
    assert.equal(event.state,toolState);
  }
});
test('receipt duration stays fixed while only an active execution has a live duration',()=>{
  const event={state:'running',startedAt:100};
  assert.equal(activityView(event,{state:'running'},undefined,2100).seconds,2);
  assert.equal(activityView(event,{state:'running',phase:'awaiting_input'},undefined,2100).seconds,null);
  assert.equal(activityView(event,{state:'running',recovery:{state:'waiting'}},undefined,2100).status,'waiting');
  assert.equal(activityView({...event,state:'done',endedAt:1100},{state:'failed'},undefined,2100).seconds,1);
  for(const endedAt of [NaN,Infinity,-1])assert.equal(activityView({...event,endedAt},{state:'failed'}).seconds,null);
});
test('observed receipts and verified step counts survive arbitrary session transitions',()=>{
  fc.assert(fc.property(fc.array(fc.constantFrom('running','done','failed','cancelled','awaiting_user','unsupported'),{minLength:1,maxLength:80}),fc.array(fc.constantFrom('done','waiting','running','pending'),{maxLength:30}),(states,stepStates)=>{
    const steps=stepStates.map((state,i)=>({id:String(i),title:String(i),state}));
    for(const state of states){
      const run={state,plan:{steps}},view=taskView(run);
      assert.equal(view.completed,stepStates.filter(s=>s==='done').length);
      for(const receipt of ['done','error','cancelled'])assert.equal(activityView({state:receipt,startedAt:1,endedAt:2},run,view).status,receipt);
      if(state!=='running')assert.notEqual(activityView({state:'running',startedAt:1},run,view).status,'running');
    }
  }),{seed:230926,numRuns:150});
});

const delegationNodes=[
  {id:'plan:source',taskId:'source',phase:'delegation',title:'수식 검토',scope:'매출 계산 근거 대조',state:'done',dependsOn:[]},
  {id:'plan:format',taskId:'format',phase:'delegation',title:'양식 분석',scope:'보존할 서식 확인',state:'waiting',dependsOn:[],summary:'머리글의 원문 확인 필요'},
  {id:'plan:merge',taskId:'merge',phase:'delegation',title:'결과 통합',scope:'조건별 근거 결합',state:'blocked',dependsOn:['source','format']}
];
test('dynamic worker view resolves role dependencies and counts only complete reports',()=>{
  const original=structuredClone(delegationNodes);
  const view=reviewWorkerView({state:'running',delegationWorkers:{nodes:delegationNodes}},'delegationWorkers');
  assert.equal(view.summary,'분석 1/3 / 확인 필요 1 / 대기 1');
  assert.deepEqual(view.nodes[2].dependencies,['수식 검토','양식 분석']);
  assert.deepEqual(view.active.map(node=>node.taskId),['format']);
  assert.deepEqual(delegationNodes,original);
});
test('dynamic worker terminal states fence unfinished work without losing receipts or role labels',()=>{
  for(const state of ['done','failed','cancelled','unsupported']){
    const view=reviewWorkerView({state,delegationWorkers:{nodes:[...delegationNodes,{id:'plan:live',taskId:'live',phase:'delegation',title:'참조 확인',state:'running',dependsOn:['source']},{id:'plan:queued',phase:'delegation',title:'결과 확인',state:'pending'}]}},'delegationWorkers');
    assert.equal(view.nodes[0].state,'done');
    assert.ok(view.nodes.slice(1).every(node=>node.state==='unconfirmed'));
    assert.equal(view.summary,'분석 1/5');
    assert.deepEqual(view.active,[]);
  }
});
test('dynamic worker UI pauses running rows while the parent waits on a user',()=>{
  const view=reviewWorkerView({state:'running',phase:'awaiting_input',delegationWorkers:{nodes:[{id:'live',phase:'delegation',title:'근거 확인',state:'running',dependsOn:['unknown']}] }},'delegationWorkers');
  assert.equal(view.nodes[0].state,'waiting');
  assert.deepEqual(view.nodes[0].dependencies,['unknown']);
  assert.equal(view.summary,'분석 0/1 / 확인 필요 1');
});
