import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {recordingProviders} from '../eval/transcript.mjs';
import {replayProviders,selectFirstMatching,normalizeRequest,valueDiffs} from '../eval/replay.mjs';
installAgent(ProjectService);
const system=text=>({role:'system',content:text});
const entry=(caller,tools,extra={})=>({request:{messages:[system(caller),{role:'user',content:'q'}],toolNames:tools},response:{content:'a',calls:[]},...extra});

test('a request takes the first unused recording of the same caller and tool list',()=>{
 const entries=[entry('You are Nubi Desktop',['read_source']),entry('Review the answer',[]),entry('You are Nubi Desktop',['read_source'])];
 const incoming={messages:[system('You are Nubi Desktop'),{role:'user',content:'other'}],toolNames:['read_source']};
 assert.deepEqual(selectFirstMatching(entries,incoming,new Set()),{matched:true,index:0});
 assert.deepEqual(selectFirstMatching(entries,incoming,new Set([0])),{matched:true,index:2});
 const unmatched=selectFirstMatching(entries,{...incoming,toolNames:['propose_patch']},new Set([0,2]));
 assert.equal(unmatched.matched,false);assert.match(unmatched.detail,/^\$\.messages\[0\]\.content expected "Review the answer"/m);
 assert.match(selectFirstMatching(entries,incoming,new Set([0,1,2])).detail,/all 3 recorded calls have already been consumed/);
});

test('volatile values are normalized before requests are compared',()=>{
 const a=normalizeRequest({messages:[{role:'tool',tool_call_id:'call_x9',content:'task 1f0e8a7c-1111-4222-8333-944455556666 at 2026-10-23T03:10:00.123Z in /private/var/folders/ab/T/nubi-1/repo hash sha256:'+'a'.repeat(64)}],toolNames:['b','a']});
 const b=normalizeRequest({messages:[{role:'tool',tool_call_id:'replay_4_0',content:'task 99999999-1111-4222-8333-944455556666 at 2026-10-24T09:00:00Z in /tmp/nubi-2/repo hash sha256:'+'b'.repeat(64)}],toolNames:['a','b']});
 assert.deepEqual(valueDiffs(a,b),[]);
 assert.deepEqual(a.toolNames,['a','b']);
 assert.deepEqual(valueDiffs({x:[1,{y:2}]},{x:[1,{y:3}]}),['$.x[1].y expected 2, received 3']);
});

async function scriptedRun(t,providers){
 const {service}=await fixture(t),task=await service.createTask({request:'app.txt 첫 줄을 알려 주세요'});
 service.providers=providers;
 await service.startAgent({taskId:task.id});await service.agent.promise;
 return service.task(task.id);
}
const call=(name,args)=>({content:'',calls:[{id:'live_'+Math.random().toString(16).slice(2),type:'function',function:{name,arguments:JSON.stringify(args)}}]});

test('a recorded run replays to the same answer without a model, and a changed harness is reported',async t=>{
 let turn=0;
 const live={status:()=>({connected:true,provider:'fixture',model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){
  turn++;if(turn===1)return call('read_source',{path:'app.txt'});
  return {content:'첫 줄은 first 입니다.',calls:[]};
 }};
 const transcript=[];
 const recorded=await scriptedRun(t,recordingProviders(live,{write:item=>transcript.push(item)}));
 assert.ok(transcript.length>=2);
 const replay=replayProviders(transcript);
 const replayed=await scriptedRun(t,replay);
 assert.equal(replayed.state,recorded.state);
 assert.equal(replayed.messages.at(-1).content,recorded.messages.at(-1).content);
 assert.equal(replay.report().unused,0);assert.equal(replay.report().served,transcript.length);
 const changed=replayProviders(transcript.map(item=>({...item,request:{...item.request,toolNames:[...item.request.toolNames,'retired_tool']}})));
 const failed=await scriptedRun(t,changed);
 assert.notEqual(failed.state,'review');assert.equal(changed.report().served,0);
});
