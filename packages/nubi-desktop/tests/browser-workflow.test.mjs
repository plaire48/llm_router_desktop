import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWorkflow,runWorkflow} from '../runtime/browser-workflow.mjs';
const snapshot=(a='e1',b='e2')=>'### Snapshot\n- textbox "Name" [ref='+a+']\n- button "Apply" [ref='+b+']';
const input={steps:[{action:'type',target:'e1',text:'새 값'},{action:'click',target:'e2'}]};
test('a workflow reuses the existing replay engine and resolves fresh refs without another model call',async()=>{
 const plan=prepareWorkflow(snapshot(),input),writes=[];
 const result=await runWorkflow(plan,{signal:new AbortController().signal,observe:async()=>snapshot('new1','new2'),act:async(name,args)=>{writes.push({name,args});return {ok:true,text:snapshot('new1','new2')};}});
 assert(result.completed);assert.deepEqual(writes,[{name:'browser_type',args:{target:'new1',text:'새 값'}},{name:'browser_click',args:{target:'new2'}}]);
});
test('ambiguous targets stop before the next write and keep the confirmed prefix',async()=>{
 const plan=prepareWorkflow(snapshot(),input),writes=[];
 const result=await runWorkflow(plan,{signal:new AbortController().signal,observe:async()=>snapshot(),act:async(name,args)=>{writes.push(name);return {ok:true,text:snapshot()+'\n- button "Apply" [ref=e3]'};}});
 assert(result.stopped);assert.deepEqual(writes,['browser_type']);assert.equal(result.confirmedSteps,1);
});
test('uncertain writes, cancellation and incomplete or framed snapshots cannot proceed to later steps',async()=>{
 for(const bad of ['\n- iframe [ref=f1]','\n…[200자 생략]'])assert.throws(()=>prepareWorkflow(snapshot()+bad,input),/development_workflow_observation/);
 assert.throws(()=>prepareWorkflow(snapshot(),{steps:[{action:'script',target:'e1',text:'anything'}]}),/development_workflow_invalid/);
 const controller=new AbortController();let issued=0;
 const result=await runWorkflow(prepareWorkflow(snapshot(),input),{signal:controller.signal,observe:async()=>snapshot(),act:async()=>{issued++;return {ok:false,execution:'unconfirmed',text:'unknown'};}});
 assert.equal(issued,1);assert(result.stopped);assert.equal(result.confirmedSteps,0);
 controller.abort();await assert.rejects(runWorkflow(prepareWorkflow(snapshot(),input),{signal:controller.signal,observe:async()=>snapshot(),act:async()=>assert.fail('cancelled')}));
});
