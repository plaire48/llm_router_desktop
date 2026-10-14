import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRunBudget,WRAP_UP} from '../runtime/run-budget.mjs';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
test('the budget counts calls and time',()=>{
  let now=0;const budget=createRunBudget({calls:2,wallMs:1000,now:()=>now});
  assert.equal(budget.reached(),false);budget.note();assert.equal(budget.reached(),false);budget.note();assert.equal(budget.reached(),true);
  const timed=createRunBudget({calls:99,wallMs:1000,now:()=>now});now=1000;assert.equal(timed.reached(),true);assert.deepEqual(timed.facts(),{calls:0,elapsedMs:1000});
});
test('past the call budget the model gets no tools and a wrap-up request once, and the run ends with its answer',async t=>{
  const {service}=await fixture(t,{scriptedPlanning:true});service.runBudgetLimits={calls:1};const seen=[];
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages,tools){
    if(String(messages[0].content).startsWith(WORK_PLAN_PROMPT))return {content:JSON.stringify({intent:{goal:'확인',constraints:[],outcomes:['파일 내용을 확인한다'],workflowIds:[],skillPaths:[]},steps:[{text:'확인',expected_outcome:'파일 내용을 확인한다',status:'in_progress'}]}),calls:[]};
    seen.push({tools:tools.length,wrap:messages.some(message=>message.role==='system'&&message.content===WRAP_UP)});
    return seen.length===1?call('read_source',{path:'app.txt'}):{content:'지금까지 app.txt를 읽었고 남은 일은 없어요.',calls:[]};
  }};
  const task=await service.createTask({request:'app.txt를 확인해 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
  const saved=service.task(task.id);
  assert.equal(saved.state,'review',saved.error);
  assert.ok(seen[0].tools>0&&!seen[0].wrap,'the first call had tools');
  assert.equal(seen[1].tools,0,'the wrap-up call has no tools');assert.equal(seen[1].wrap,true);
  assert.equal(saved.runBudget?.reached,true);assert.equal(saved.runBudget.calls,1,'the calls made before the wrap-up');
  assert.match(saved.messages.at(-1).content,/남은 일은 없어요/);
});
