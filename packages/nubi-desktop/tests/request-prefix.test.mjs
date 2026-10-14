import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);
// Prompt caching needs the same beginning on every request (bundle 2.3, 2026-10-15): the system messages and the tool
// definitions of one run must not change between its model calls. What changes (receipts, plan state) stays behind.
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
test('the system messages and tool definitions are identical across the model calls of one run',async t=>{
  const {service}=await fixture(t,{scriptedPlanning:true});const seen=[];let round=0;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages,tools){
    if(String(messages[0].content).startsWith(WORK_PLAN_PROMPT))return {content:JSON.stringify({intent:{goal:'확인',constraints:[],outcomes:['파일 내용을 확인한다'],workflowIds:[],skillPaths:[]},steps:[{text:'확인',expected_outcome:'파일 내용을 확인한다',status:'in_progress'}]}),calls:[]};
    if(tools.length)seen.push({system:messages.filter(message=>message.role==='system').map(message=>message.content),tools});
    round++;return round===1?call('read_source',{path:'app.txt'}):round===2?call('source_search',{query:'first'}):{content:'확인했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'app.txt를 확인해 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.ok(seen.length>=3,'three actor calls');
  for(const later of seen.slice(1)){
    assert.deepEqual(later.system,seen[0].system,'system messages changed between calls');
    assert.deepEqual(later.tools,seen[0].tools,'tool definitions changed between calls');
  }
  assert.equal(seen[0].system.filter(text=>text.includes('at most 8 tool calls')).length,1,'the batch limit line is in the system prompt once');
});
