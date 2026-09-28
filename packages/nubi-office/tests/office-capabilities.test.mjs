import test from 'node:test';
import assert from 'node:assert/strict';
import {officeCapabilities,CONTENT_OPERATIONS} from '../worker/office-capabilities.mjs';
import {contentToolsFor} from '../worker/content-agent.mjs';
import {contentOperation} from '../worker/content-schema.mjs';
import {createSkillWorkspace} from '../worker/skill-workspace.mjs';
import {createToolProgressGuard} from '../worker/tool-progress.mjs';
import {createActivityLog} from '../worker/activity.mjs';

test('actual Word and PowerPoint tool envelopes describe only their implemented operation formats',()=>{
  const word=contentToolsFor('word').find(t=>t.function.name==='apply_operation').function;
  const ppt=contentToolsFor('powerpoint').find(t=>t.function.name==='apply_operation').function;
  for(const name of CONTENT_OPERATIONS.word)assert.ok(word.description.includes('type:'+name));
  for(const name of CONTENT_OPERATIONS.powerpoint)assert.ok(ppt.description.includes('type:'+name));
  assert.equal(word.description.includes('type:add_slide'),false);assert.equal(ppt.description.includes('type:append_table'),false);
  assert.throws(()=>contentToolsFor('excel'),/unsupported_office_host/);
  assert.throws(()=>contentOperation('word',{type:'add_slide',title:'x',bullets:[],notes:''},{created:true,items:[]}),/unsupported_operation/);
  assert.throws(()=>contentOperation('powerpoint',{type:'append_paragraph',text:'x',style:'Normal'},{created:true,items:[]}),/unsupported_operation/);
});
test('Office major version 16 and add-in runtime facts never prove edition, live-model quality or operation success',()=>{
  for(const host of ['excel','word','powerpoint']){
    const runtime={host,platform:'win32',officeVersion:'16.0',processBitness:32,observedAt:Date.now()};
    const result=officeCapabilities(host,runtime);
    if(host==='excel')assert.deepEqual(result.nativeOperations,['set_values','set_formulas','format_range']);
    assert.equal(result.runtime.version16,true);assert.equal(result.runtime.office2016Edition,'unverified');
    assert.equal(result.validation.actualOffice2016,'not_measured');assert.equal(result.validation.liveModelQuality,'not_measured');assert.equal(result.validation.nasca,'not_verified');
    assert.ok(result.capabilities.some(c=>c.status==='not_implemented'));
    assert.equal(officeCapabilities(host,{...runtime,platform:'darwin'}).runtime.state,'unverified');
    assert.equal(officeCapabilities(host).runtime.state,'unverified');
    assert.equal(officeCapabilities(host,{...runtime,officeVersion:'15.0'}).runtime.version16,false);
  }
});
test('the registered-skill workspace exposes a read-only capability tool without granting native operations',async()=>{
  const workspace=createSkillWorkspace({host:'word',signal:new AbortController().signal,metrics:{},activity:createActivityLog(),officeRuntime:{host:'word',platform:'win32',officeVersion:'16.0',processBitness:64,observedAt:Date.now()}});
  const before=workspace.progress();assert.equal(workspace.has('office_capabilities'),true);
  const result=await workspace.execute('office_capabilities',{});assert.equal(result.host,'word');assert.equal(result.runtime.processBitness,64);
  assert.deepEqual(workspace.progress(),before);assert.equal(workspace.has('apply_operation'),false);
  assert.match(result.instruction,/only tools actually offered/);assert.match(result.skills.note,/cannot add unsupported/);
});

test('capability and skill tools cannot loop without observed progress',async()=>{
  for(const name of ['office_capabilities','list_document_skills','use_document_skill']){
    let issued=0,paused=0;const metrics={};
    const guard=createToolProgressGuard({signal:new AbortController().signal,activity:createActivityLog(),metrics,getProgress:()=>({unchanged:true}),onStall:async()=>{paused++;}});
    for(let i=0;i<4;i++)await guard.run(name,{},async()=>{issued++;return{ok:true};});
    assert.equal(issued,2);assert.equal(paused,1);assert.equal(metrics.toolProgress.prevented,2);
  }
});
