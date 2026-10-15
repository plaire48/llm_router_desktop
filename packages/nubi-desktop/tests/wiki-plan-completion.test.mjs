import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wikiPlanPending} from '../runtime/wiki-plan-completion.mjs';

const tools=[{type:'function',function:{name:'submit_plan'}}];
const call={role:'assistant',content:'',tool_calls:[{id:'plan',function:{name:'submit_plan',arguments:'{}'}}]};
const accepted={role:'tool',tool_call_id:'plan',content:'{"status":"accepted","totalPages":1}'};
test('only the matching native accepted plan allows the planner to end',()=>{
  assert.equal(wikiPlanPending([],tools),true);
  assert.equal(wikiPlanPending([call,accepted],tools),false);
  assert.equal(wikiPlanPending([call,{...accepted,tool_call_id:'another'}],tools),true);
  assert.equal(wikiPlanPending([{...accepted,role:'user'}],tools),true);
  assert.equal(wikiPlanPending([call,{...accepted,content:'{"status":"rejected"}'}],tools),true);
  assert.equal(wikiPlanPending([call,{...accepted,content:'not JSON'}],tools),true);
  assert.equal(wikiPlanPending([],[]),false);
  assert.equal(wikiPlanPending([],[{function:{name:'submit_page'}}]),false,'page/research answers are unchanged');
});
