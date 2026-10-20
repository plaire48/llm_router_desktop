import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {validateWorkflow} from '../runtime/workflow-schema.mjs';
import {createAdapters,createSyntheticAdapters} from '../runtime/workflow-adapters.mjs';
import {saveBrowserScript,reviewBrowserScript} from '../runtime/browser-scripts.mjs';
installAgent(ProjectService);

// Browser teach plan T6: a saved script is a workflow tool step that runs without a model.
const card=()=>({schemaVersion:1,title:'숫자 입력',status:'draft',startPage:'https://demo.invalid/inputs',inputs:[{slot:'v1',label:'Number'}],steps:[{tool:'fill_form',fields:[{target:{role:'textbox',name:'',kind:'field',tag:'input',type:'number',context:[{role:'group',name:'Number'}]},slot:'v1'}]}]});
const workflow=extra=>({name:'스크립트',version:1,trigger:{kind:'manual'},inputs:{number:{type:'string',required:true}},permissions:{tools:['browser'],externalWrite:'ask'},steps:[{id:'run',kind:'tool',adapter:'browser.script',args:{script:'inputs',values:{v1:'{{ inputs.number }}'}}}],...extra});
const ctx={stepId:'run',summary:'저장한 브라우저 스크립트를 실행합니다.'};

test('browser.script is a known tool step that needs the browser permission',()=>{
  assert.equal(validateWorkflow(workflow()).ok,true);
  assert.equal(validateWorkflow(workflow({steps:[{...workflow().steps[0],adapter:'browser.run'}]})).errors[0].code,'workflow_adapter_unknown');
  assert.equal(validateWorkflow(workflow({permissions:{tools:['web'],externalWrite:'ask'}})).errors[0].code,'workflow_permission_widened');
  assert.equal(validateWorkflow(workflow({permissions:{tools:['browser.script'],externalWrite:'ask'}})).ok,true,'the exact adapter id is also a permission');
});

test('the adapter refuses unreviewed scripts, missing or extra values and a missing start page before touching a browser',async t=>{
  const f=await fixture(t),task=await f.service.createTask({request:'합성 브라우저 스크립트를 실행합니다.'});f.service.store.set('task:'+task.id,{...task,state:'review'});
  const adapters=createAdapters(f.service,{taskId:task.id,runId:'run-test'}),root=await f.service.target(task.id);
  await saveBrowserScript(root,{slug:'inputs',card:card()});
  await assert.rejects(adapters.browser.script({script:'inputs',values:{v1:'42'}},ctx),/browser_script_not_reviewed/);
  await reviewBrowserScript(root,'inputs');
  await assert.rejects(adapters.browser.script({script:'inputs',values:{}},ctx),/browser_script_inputs_missing/);
  await assert.rejects(adapters.browser.script({script:'inputs',values:{v1:'42',v9:'x'}},ctx),/browser_script_inputs_invalid/);
  const noStart=card();delete noStart.startPage;await saveBrowserScript(root,{slug:'nostart',card:noStart});await reviewBrowserScript(root,'nostart');
  await assert.rejects(adapters.browser.script({script:'nostart',values:{v1:'42'}},ctx),/browser_script_start_missing/);
  // The fixture service has no browser: the run stops there, after every check passed.
  await assert.rejects(adapters.browser.script({script:'inputs',values:{v1:'42'}},ctx),/workflow_browser_unavailable/);
  await assert.rejects(adapters.browser.script({script:'../x',values:{}},ctx),/browser_script_slug_invalid/);
  assert.equal(adapters.browser.irreversible({script:'inputs'}),false);
});

test('synthetic adapters answer browser.script from fixtures for dry runs',async()=>{
  const synthetic=createSyntheticAdapters({responses:{run:{ok:true,result:{completed:true,confirmedSteps:1},receipts:['fixture:run']}}});
  assert.deepEqual(await synthetic.browser.script({script:'inputs',values:{v1:'42'}},{stepId:'run'}),{ok:true,result:{completed:true,confirmedSteps:1},receipts:['fixture:run']});
});
