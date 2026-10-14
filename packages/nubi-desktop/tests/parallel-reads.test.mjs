import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);
// Independent reads of one response run together and come back in the same turn (bundle 2.1, 2026-10-15); a write
// in the same response still runs alone and the read after it is deferred, as before.
const calls=list=>({content:'',calls:list.map(([name,args])=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}))});
async function run(t,steps){
  const {service,root}=await fixture(t,{scriptedPlanning:true});await writeFile(path.join(root,'b.txt'),'second\n');
  const requests=[];let at=0;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages,tools){
    if(String(messages[0].content).startsWith(WORK_PLAN_PROMPT))return {content:JSON.stringify({intent:{goal:'확인',constraints:[],outcomes:['파일 내용을 확인한다'],workflowIds:[],skillPaths:[]},steps:[{text:'확인',expected_outcome:'파일 내용을 확인한다',status:'in_progress'}]}),calls:[]};
    const names=new Map();for(const message of messages)for(const call of message.tool_calls||[])names.set(call.id,call.function.name);
    const results=messages.filter(message=>message.role==='tool'&&names.get(message.tool_call_id)!=='update_plan').map(message=>({tool:names.get(message.tool_call_id),result:JSON.parse(message.content)}));
    requests.push({system:messages.filter(message=>message.role==='system').map(message=>message.content).join('\n'),results,names:tools.map(item=>item.function.name)});
    return steps[at++]?.(requests.at(-1))||{content:'확인했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'app.txt와 b.txt를 확인해 줘'});
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  return {requests,service,task};
}
test('two reads in one response both execute and return together',async t=>{
  const {requests}=await run(t,[()=>calls([['read_source',{path:'app.txt'}],['read_source',{path:'b.txt'}]])]);
  const results=requests[1].results.filter(item=>item.tool==='read_source');
  assert.equal(results.length,2);
  assert.ok(results.every(item=>item.result.ok!==false&&!item.result.deferred),JSON.stringify(results.map(item=>item.result)).slice(0,300));
  assert.match(requests[0].system,/may go together in one response/,'the model is told reads may be batched');
});
test('a read after an action in the same response does not run in that response',async t=>{
  // update_wiki is an action (not in READ_TOOLS); on a plain folder it returns without a pull. The read behind it waits.
  const {requests}=await run(t,[()=>calls([['update_wiki',{}],['read_source',{path:'app.txt'}]])]);
  const read=requests[1].results.find(item=>item.tool==='read_source');
  assert.ok(read?.result?.deferred===true||read?.result?.error==='tool_replan_required',JSON.stringify(read?.result).slice(0,300));
});
