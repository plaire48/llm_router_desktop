import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateWorkflow, WORKFLOW_SCHEMA} from '../runtime/workflow-schema.mjs';

const adapters={web:['read','verify'],terminal:['run'],documents:['exists','read','hash']};
const base={name:'시범',version:1,trigger:{kind:'manual'},inputs:{ticket:{type:'string',required:true}},permissions:{tools:['web','documents','wiki'],externalWrite:'ask'},steps:[
  {id:'read',kind:'tool',adapter:'web.read',args:{url:'{{ inputs.ticket }}'},verify:{kind:'text_present',value:'{{ inputs.ticket }}'}},
  {id:'draft',kind:'agent',goal:'초안',tools:['wiki_query','propose_new_file'],done_when:{kind:'file_exists',path:'out/{{ inputs.ticket }}.md'},outputs:{schema:{type:'object',required:['summary'],properties:{summary:{type:'string'}}}},budget:{calls:20,minutes:10}},
  {id:'ok',kind:'human',ask:'승인?',outputs:{decision:['approve','revise']}}
]};
const code=document=>validateWorkflow(document,{adapters}).errors?.[0]?.code;

test('a valid workflow preserves declarations and adds host resolved tools',()=>{
  const result=validateWorkflow(base,{adapters});
  assert.equal(result.ok,true);assert.deepEqual(result.workflow.steps[1].tools,base.steps[1].tools);assert.ok(result.workflow.steps[1].resolvedTools.includes('inspect_path'));assert.equal(base.steps[1].resolvedTools,undefined);assert.equal(WORKFLOW_SCHEMA.type,'object');
});
test('the optional action summary declared in the design is preserved',()=>{
  const document={...base,steps:[{...base.steps[0],action_summary:'변경 요청의 현재 상태를 읽습니다.'}]};
  assert.equal(validateWorkflow(document,{adapters}).ok,true);
});
test('unknown adapters and plain credentials are rejected without echoing values',()=>{
  assert.equal(code({...base,steps:[{id:'x',kind:'tool',adapter:'mail.send',args:{}}]}),'workflow_adapter_unknown');
  const value='ghp_abcdefghijklmnopqrstuvwxyz0123';
  const result=validateWorkflow({...base,inputs:{token:{type:'string',default:value}}},{adapters});
  assert.equal(result.errors[0].code,'workflow_secret_plain');assert.equal(JSON.stringify(result.errors).includes(value),false);
  assert.equal(validateWorkflow({...base,inputs:{key:{type:'string',default:'secret:업무키'}}},{adapters}).ok,true);
});
test('cycles, missing targets and duplicate step identifiers are rejected',()=>{
  assert.equal(code({...base,steps:[{id:'a',kind:'branch',when:'true',then:'b'},{id:'b',kind:'branch',when:'true',then:'a'}]}),'workflow_cycle');
  assert.equal(code({...base,steps:[{id:'a',kind:'branch',when:'true',then:'missing'}]}),'workflow_schema');
  assert.equal(code({...base,steps:[base.steps[0],base.steps[0]]}),'workflow_schema');
  assert.equal(code({...base,steps:[{...base.steps[0],next:'read'}]}),'workflow_cycle');
});
test('step permissions can only narrow inherited tools and external writes',()=>{
  assert.equal(code({...base,steps:[{...base.steps[0],permissions:{tools:['web','terminal']}}]}),'workflow_permission_widened');
  assert.equal(code({...base,permissions:{tools:['web'],externalWrite:'never'},steps:[{id:'p',kind:'tool',adapter:'web.read',args:{},externalWrite:true}]}),'workflow_external_write_forbidden');
  assert.equal(code({...base,permissions:{tools:['web'],externalWrite:'never'},steps:[{...base.steps[0],permissions:{externalWrite:'ask'}}]}),'workflow_permission_widened');
  assert.equal(code({...base,steps:[{id:'x',kind:'tool',adapter:'terminal.run',args:{}}]}),'workflow_permission_widened');
});
test('malformed structure and output schema fail closed',()=>{
  for(const change of [{version:0},{steps:[]},{steps:[{id:'Bad id',kind:'tool',adapter:'web.read'}]},{steps:[{id:'a',kind:'unknown'}]},
    {steps:[{...base.steps[1],outputs:{schema:{type:'made-up'}}}]}])assert.equal(code({...base,...change}),'workflow_schema');
  assert.equal(code(null),'workflow_schema');
});
test('cycle detection includes the default sequential successor',()=>{
  assert.equal(code({...base,steps:[{...base.steps[0],next:'ok'},base.steps[1],{...base.steps[2],next:'draft'}]}),'workflow_cycle');
});
test('an explicit branch else replaces the sequential successor',()=>{
  const document={...base,steps:[{id:'choose',kind:'branch',when:'true',then:'end',else:'end'},
    {...base.steps[0],next:'choose'},{id:'end',kind:'human',ask:'종료 확인'}]};
  assert.equal(validateWorkflow(document,{adapters}).ok,true);
});
test('separate workflows may use the same output schema identifier',()=>{
  for(const type of ['string','number']){
    const document=structuredClone(base);document.steps[1].outputs.schema={$id:'urn:nubi:step-output',type:'object',properties:{value:{type}}};
    assert.equal(validateWorkflow(document,{adapters}).ok,true);
  }
});
