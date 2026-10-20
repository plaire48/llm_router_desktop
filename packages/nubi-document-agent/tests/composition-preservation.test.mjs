import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertPreservedComposition,reviseComposition} from '../dist/composition.js';
import {createHostModelTransport} from '../dist/host-model.js';

const slide=text=>({notes:'원천 보존',elements:[{kind:'text',text,x:.5,y:.5,w:10,h:1,fontSize:24}]});
const original=()=>({title:'업무 회의',slides:[slide('첫째'),slide('마지막')]}),signal=()=>new AbortController().signal;
test('protected array indices reject insertion before the last slide but permit an append',()=>{
 const before=original(),wrong={...before,slides:[before.slides[0],slide('추가'),before.slides[1]]},good={...before,slides:[...before.slides,slide('추가')]};
 assert.throws(()=>assertPreservedComposition(before,wrong,['/slides/0','/slides/1']),/composition_preservation_changed/);
 assert.doesNotThrow(()=>assertPreservedComposition(before,good,['/slides/0','/slides/1']));
 for(const paths of [['/slides/99'],['/__proto__'],['/slides/~3'],['/slides/'],null,{}])assert.throws(()=>assertPreservedComposition(before,before,paths),/composition_preservation_invalid/);
});
test('preservation follows canonical values for paragraphs and exact workbook formulas',()=>{
 const before={title:'보존',blocks:[{text:'기존',style:'body'}],sheets:[{cells:[{formula:'SUM(1,2)',address:'A1'}]}]};
 assert.doesNotThrow(()=>assertPreservedComposition(before,{blocks:[{style:'body',text:'기존'}]},['/blocks/0']));
 assert.throws(()=>assertPreservedComposition(before,{sheets:[{cells:[{address:'A1',formula:'3'}]}]},['/sheets/0']),/composition_preservation_changed/);
});
test('the real planning contract rejects a shifted sibling, gives location feedback and accepts a corrected append',async()=>{
 const plan=original();let count=0,feedback='';
 const transport=createHostModelTransport({id:'contract-test',async complete(messages){
  const tools=messages.filter(m=>m.role==='tool');
  if(!tools.length)return {content:'',calls:[{id:'read',function:{name:'read_powerpoint_sources',arguments:{}}}]};
  if(tools.length<3){count++;return {content:'',calls:[{id:'edit-'+count,function:{name:'submit_powerpoint_draft',arguments:{patches:[{op:'add',path:'/slides/'+(count===1?1:2),value:slide('추가')}]}}}]};}
  feedback=tools[1].content;return {content:'Prepared',calls:[]};
 }});
 const result=await reviseComposition('powerpoint',{request:'맨 뒤 한 장 추가',plan,sources:{}},transport,signal(),{allowedPaths:['/slides'],preservePaths:['/slides/0','/slides/1']});
 assert.equal(count,2);assert.deepEqual(result.plan.slides.slice(0,2),plan.slides);assert.match(feedback,/composition_preservation_changed/);assert.match(feedback,/\/slides\/1/);
});
test('pending edits cannot widen their protected scope or mutate the observed baseline',async()=>{
 const plan=original(),input={request:'맨 뒤 한 장 추가',plan,sources:{}},options={allowedPaths:['/slides'],preservePaths:['/slides/0','/slides/1']};let released,entered;
 const gate=new Promise(r=>released=r),ready=new Promise(r=>entered=r);
 const transport=createHostModelTransport({id:'contract-test',async complete(messages){
  const tools=messages.filter(m=>m.role==='tool');if(!tools.length){entered();await gate;return {content:'',calls:[{id:'read',function:{name:'read_powerpoint_sources',arguments:{}}}]};}
  if(tools.length===1)return {content:'',calls:[{id:'edit',function:{name:'submit_powerpoint_draft',arguments:{patches:[{op:'add',path:'/slides/2',value:slide('추가')}]}}}]};
  return {content:'Prepared',calls:[]};
 }});
 const promise=reviseComposition('powerpoint',input,transport,signal(),options);await ready;plan.slides[0]=slide('외부 변경');options.preservePaths.length=0;options.allowedPaths.push('/title');released();
 const result=await promise;assert.equal(result.plan.slides[0].elements[0].text,'첫째');assert.equal(result.plan.slides.length,3);
});
