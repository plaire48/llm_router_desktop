import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectService} from '../runtime/project-service.mjs';
import {ProjectServices} from '../runtime/project-services.mjs';
import {mergeSnapshot} from '../ui/mergeSnapshot.js';
import {mergeAgentStream} from '../ui/agent-stream.mjs';
test('token refresh reads no stored transcripts, source files or background project state',()=>{
 const run={running:true,runId:'r',streamRevision:4,streamingAnswer:'public text',streamingReasoning:'provider notes',timing:{snapshot:()=>({elapsedMs:800})}};
 const host={ready(){},agentForTask:id=>id==='t'?run:null,store:{list(){assert.fail('stream read must not read SQLite history');}}};
 const value=ProjectService.prototype.state.call(host,{taskId:'t',streamOnly:true});
 assert.deepEqual(value,{stream:{taskId:'t',runId:'r',streamRevision:4,streamingAnswer:'public text',streamingReasoning:'provider notes',timing:{elapsedMs:800}}});
 assert.deepEqual(ProjectService.prototype.state.call(host,{taskId:'other',streamOnly:true}),{stream:null});
});
test('the project multiplexer does not append a background overview to a stream read',async()=>{
 const service={projectId:'p',invoke:async()=>({stream:{runId:'r'}})},projects=new ProjectServices({service});
 projects.status=()=>assert.fail('stream reads must not inspect other projects');
 assert.deepEqual(await projects.invoke('state',{_projectId:'p',taskId:'t',streamOnly:true}),{stream:{runId:'r'}});
 await assert.rejects(projects.invoke('state',{_projectId:'another',streamOnly:true}),/project_changed/);
});
const project=()=>({projectId:'p',tasks:[{id:'t',state:'running',responseTiming:{runId:'r',afterMessageId:'u'},streamRevision:2,streamingAnswer:'old',messages:[{content:'retained'}]},{id:'other',messages:[{content:'not read'}]}]});
const stream=(revision=3)=>({taskId:'t',runId:'r',streamRevision:revision,streamingAnswer:'latest',streamingReasoning:'',timing:{elapsedMs:900}});
test('stream patch preserves history, other tasks and the originating message',()=>{
 const original=project(),updated=mergeAgentStream(original,'p',stream());
 assert.equal(updated.tasks[0].streamingAnswer,'latest');assert.equal(updated.tasks[0].messages,original.tasks[0].messages);assert.equal(updated.tasks[1],original.tasks[1]);assert.equal(updated.tasks[0].responseTiming.afterMessageId,'u');
 for(const value of [stream(1),{...stream(),runId:'different'},{...stream(),taskId:'missing'}])assert.equal(mergeAgentStream(original,'p',value),original);
 assert.equal(mergeAgentStream(original,'elsewhere',stream()),original);
});
test('a late full snapshot never rolls public text backward, but completion and a new run still replace it',()=>{
 const current=mergeAgentStream(project(),'p',stream(5)),stale=project();stale.tasks[0].trace=[{status:'done'}];
 const merged=mergeSnapshot(current,stale);assert.equal(merged.tasks[0].streamingAnswer,'latest');assert.deepEqual(merged.tasks[0].trace,[{status:'done'}]);
 const finished=project();finished.tasks[0].state='review';delete finished.tasks[0].streamRevision;delete finished.tasks[0].streamingAnswer;assert.equal(mergeSnapshot(current,finished).tasks[0].streamingAnswer,undefined);
 const next=project();next.tasks[0].responseTiming.runId='new-run';assert.equal(mergeSnapshot(current,next).tasks[0].streamingAnswer,'old');
});
