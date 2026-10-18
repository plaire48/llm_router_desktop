import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRunMetrics,summarizeTaskMetrics} from '../runtime/run-metrics.mjs';
import {fixture} from './fixtures.mjs';
test('task usage aggregates two runs by six purposes, actual tokens, attempts, tools and compaction without other tasks',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'사용량 확인'});let now=0;
 for(const [runId,purposes] of [['one',['planner','actor','actor','research']],['two',['actor','actor','reviewer','research']]]){
  const m=createRunMetrics({store:service.store,taskId:task.id,runId,now:()=>now});
  for(const purpose of purposes){const call=m.beginModel({purpose,attempt:purpose==='reviewer'?2:1,messages:[],tools:[]});now+=100;call.end({usage:{prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{cached_tokens:20}}});}
  m.beginTool({tool:'read_source'}).end({});if(runId==='two')m.compaction({trigger:'threshold',beforeTokens:100,afterTokens:50});
 }
 createRunMetrics({store:service.store,taskId:'other',runId:'other'}).beginModel({purpose:'actor',messages:[],tools:[]}).end({usage:{prompt_tokens:99999}});
 const out=summarizeTaskMetrics(service.store,task.id);assert.equal(out.rows.length,6);assert.equal(out.rows.find(r=>r.purpose==='actor').calls,4);assert.equal(out.rows.find(r=>r.purpose==='research').calls,2);
 assert.deepEqual([out.modelCalls,out.toolCalls,out.compactions,out.retries,out.elapsedMs],[8,2,1,1,800]);assert.equal(out.rows.reduce((n,r)=>n+(r.promptTokens??0),0),800);assert.equal(out.runCount,2);
 const api=await service.invoke('taskUsage',{taskId:task.id});assert.deepEqual(api,out);assert(!JSON.stringify(out).includes('99999'));await assert.rejects(service.invoke('taskUsage',{taskId:'missing'}),/task_missing/);
});
test('missing and partial token reports stay distinct from measured zero; document and Wiki work join analysis',async t=>{
 const {service}=await fixture(t);const m=createRunMetrics({store:service.store,taskId:'t',runId:'r'});
 const call=(purpose,usage)=>m.beginModel({purpose,messages:[],tools:[]}).end({usage});call('actor');call('actor',{prompt_tokens:0,completion_tokens:5});call('document',{prompt_tokens:10});call('wiki_update',{prompt_tokens:20,completion_tokens:0,prompt_tokens_details:{cached_tokens:0}});call('research');
 const out=summarizeTaskMetrics(service.store,'t'),actor=out.rows.find(r=>r.purpose==='actor'),analysis=out.rows.find(r=>r.purpose==='analysis'),child=out.rows.find(r=>r.purpose==='research');
 assert.equal(actor.promptTokens,0);assert.equal(actor.reports.promptTokens,1);assert.equal(actor.cachedTokens,null);assert.equal(child.promptTokens,null);assert.equal(analysis.calls,2);assert.equal(analysis.promptTokens,30);assert.equal(analysis.reports.completionTokens,1);assert.equal(analysis.cachedTokens,0);
 assert.equal(out.retentionDays,30);assert.equal(summarizeTaskMetrics(service.store,'missing').modelCalls,0);
});
