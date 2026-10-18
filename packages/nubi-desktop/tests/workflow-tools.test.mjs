import {test} from 'node:test';
import assert from 'node:assert/strict';
import {expandStepTools,TOOL_PREREQUISITES} from '../runtime/workflow-tools.mjs';
import {validateWorkflow} from '../runtime/workflow-schema.mjs';

test('host expands prerequisites, deduplicates and records why without changing declarations',()=>{
  const declared=['propose_new_file','read_source'];
  const result=expandStepTools(declared);
  assert.deepEqual(result.tools.slice().sort(),['inspect_path','propose_new_file','read_source','record_change_plan','submit_step_output','update_plan']);
  assert.deepEqual(declared,['propose_new_file','read_source']);
  assert.equal(result.added.find(row=>row.tool==='inspect_path').because,'propose_new_file');
  assert.ok(Object.isFrozen(TOOL_PREREQUISITES));
});
test('every approved prerequisite and common tool is included exactly once',()=>{
  for(const [tool,prerequisites] of Object.entries(TOOL_PREREQUISITES)){
    const result=expandStepTools([tool]);
    for(const name of [...prerequisites,'update_plan','submit_step_output'])assert.ok(result.tools.includes(name));
    assert.equal(new Set(result.tools).size,result.tools.length);
  }
});
test('validation rejects unknown names and returns separate declared and resolved tools',()=>{
  const source={name:'시범',version:1,permissions:{tools:['documents'],externalWrite:'never'},steps:[{id:'a',kind:'agent',goal:'초안',tools:['propose_new_file'],done_when:{kind:'file_exists',path:'out.md'}}]};
  const validated=validateWorkflow(source);
  assert.equal(validated.ok,true);
  assert.deepEqual(validated.workflow.steps[0].tools,['propose_new_file']);
  assert.ok(validated.workflow.steps[0].resolvedTools.includes('record_change_plan'));
  assert.equal(source.steps[0].resolvedTools,undefined);
  for(const tool of ['invented_tool','mcp__invented__execute','__proto__']){
    assert.equal(validateWorkflow({...source,steps:[{...source.steps[0],tools:[tool]}]}).errors[0].code,'workflow_tool_unknown');
    assert.throws(()=>expandStepTools([tool]),/workflow_tool_unknown/);
  }
});
