// Workflows and routines are off in this release (user decision 2026-10-22, design light-flow §5.1).
// The code and stored data stay; every entry point refuses with workflow_feature_off.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {workflowsEnabled,requireWorkflows,guardWorkflowMethods,WORKFLOW_SERVICE_METHODS,WORKFLOW_READ_METHODS} from '../runtime/workflow-feature.mjs';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);

test('workflows are off in this release and the switch has no bypass',()=>{
 assert.equal(DESKTOP_FEATURES.workflows,false);
 assert.ok(Object.isFrozen(DESKTOP_FEATURES));
 process.env.NUBI_WORKFLOWS='on';
 try{assert.equal(workflowsEnabled(),false);}finally{delete process.env.NUBI_WORKFLOWS;}
 assert.throws(()=>requireWorkflows(),/workflow_feature_off/);
 assert.doesNotThrow(()=>requireWorkflows({workflows:true}));
});
test('every installed workflow service method refuses while the switch is off',async()=>{
 assert.ok(WORKFLOW_SERVICE_METHODS.includes('listWorkflows')&&WORKFLOW_SERVICE_METHODS.includes('startWorkflow')&&WORKFLOW_SERVICE_METHODS.includes('registerWorkflowRoutine'));
 class Fake{};for(const name of WORKFLOW_SERVICE_METHODS)Fake.prototype[name]=async()=>'ran';
 const guarded=guardWorkflowMethods(Fake,{workflows:false});
 assert.deepEqual(guarded,WORKFLOW_SERVICE_METHODS.filter(name=>!WORKFLOW_READ_METHODS.includes(name)));
 for(const name of guarded)await assert.rejects(()=>Fake.prototype[name].call(new Fake(),{}),/workflow_feature_off/);
});
test('the guard passes through when the switch is on',async()=>{
 class Fake{};Fake.prototype.listWorkflows=async function(){return ['ok',this.tag];};
 guardWorkflowMethods(Fake,{workflows:true});
 const item=new Fake();item.tag='same-this';
 assert.deepEqual(await item.listWorkflows(),['ok','same-this']);
});
test('the real project service refuses workflow calls, including through the host allowlist',async t=>{
 const {service}=await fixture(t);
 await assert.rejects(()=>service.listWorkflows(),/workflow_feature_off/);
 await assert.rejects(()=>service.invoke('listWorkflows',{}),/workflow_feature_off/);
});
test('a stored workflow conversation cannot resume or stop through the runner and says why',async t=>{
 const {service}=await fixture(t);
 service.store.set('task:w1',{id:'w1',kind:'workflow',state:'waiting_input',workflowRunId:'r1',question:{id:'q',text:'계속할까요?'},messages:[],trace:[]});
 await assert.rejects(()=>service.answerAgent({taskId:'w1',answer:'네'}),/workflow_feature_off/);
 await assert.rejects(()=>service.stopAgent({taskId:'w1'}),/workflow_feature_off/);
 assert.equal(service.store.get('task:w1').state,'waiting_input','stored data stays untouched');
});
test('reading a stored run stays allowed so past results remain visible',async()=>{
 assert.deepEqual(WORKFLOW_READ_METHODS,['workflowRun']);
 class Fake{};for(const name of WORKFLOW_SERVICE_METHODS)Fake.prototype[name]=async()=>'ran';
 guardWorkflowMethods(Fake,{workflows:false});
 assert.equal(await Fake.prototype.workflowRun.call(new Fake(),{runId:'r'}),'ran');
});
