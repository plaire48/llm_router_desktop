import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {catalogEntries,catalogMutation} from '../src/template-catalog.js';

const id='f00dbabe-0000-4000-8000-000000000001';
test('catalog rejects another host, duplicate entries and invalid revisions instead of silently hiding them',()=>{
  const entry={id,host:'word',name:'업무 양식',summary:'관찰한 구조',revision:1,available:true,inputCount:2,itemCount:5};
  const response={host:'word',entries:[entry],unreadable:0};
  assert.equal(catalogEntries(response,'word').length,1);
  for(const value of [{...response,host:'excel'},{...response,entries:[entry,entry]},{...response,entries:[{...entry,host:'powerpoint'}]},{...response,entries:[{...entry,revision:0}]}])assert.throws(()=>catalogEntries(value,'word'),/template_record_invalid/);
});
test('lost catalog mutations reconcile the same operation without retrying file or metadata changes',async()=>{
  for(const method of ['template_register','template_catalog_index','template_catalog_use','template_catalog_rename','template_catalog_remove']){
    const calls=[];
    const result=await catalogMutation(method,{templateId:id},{operationId:id,call:async(name,payload)=>{
      calls.push({name,payload});if(name===method)throw new Error('office_timeout');return{outcome:'applied',result:{confirmed:true}};
    }});
    assert.equal(result.confirmed,true);assert.deepEqual(calls.map(c=>c.name),[method,'template_catalog_receipt']);assert.equal(calls[1].payload.operationId,id);
  }
});
test('uncertain or unreadable receipts stop; permanent errors do not start reconciliation',async()=>{
  for(const outcome of ['uncertain','not_executed','receipt_failure']){
    let mutations=0,reads=0;
    await assert.rejects(catalogMutation('template_catalog_use',{templateId:id},{call:async method=>{if(method==='template_catalog_use'){mutations++;throw new Error('office_timeout');}reads++;if(outcome==='receipt_failure')throw new Error('office_timeout');return{outcome};}}),/write_uncertain/);
    assert.equal(mutations,1);assert.equal(reads,1);
  }
  let calls=0;await assert.rejects(catalogMutation('template_catalog_use',{templateId:id},{call:async()=>{calls++;throw new Error('template_source_changed');}}),/template_source_changed/);assert.equal(calls,1);
  await assert.rejects(catalogMutation('runStart',{},{}),/unsafe_tool_retry/);
});
test('fast-check: renamed labels and cancelled results survive a lost acknowledgement without duplicate mutation',async()=>{
  await fc.assert(fc.asyncProperty(fc.string({minLength:1,maxLength:100}),fc.boolean(),async(name,cancelled)=>{
    let count=0;const payload={templateId:id,name,revision:1},original=structuredClone(payload),saved={name,cancelled};
    const result=await catalogMutation('template_catalog_rename',payload,{operationId:id,call:async(method,data)=>{
      if(method==='template_catalog_rename'){count++;assert.deepEqual(data,{...original,operationId:id});throw new Error('office_timeout');}
      return{outcome:'applied',result:saved};
    }});
    assert.deepEqual(payload,original);assert.deepEqual(result,saved);assert.equal(count,1);
  }),{seed:230924,numRuns:60});
});
