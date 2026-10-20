import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateComposition,prepareComposition} from '../dist/composition.js';
import {createHostModelTransport} from '../dist/host-model.js';

const plan=()=>({title:'Meeting',slides:[{notes:'가상 업무',elements:[{kind:'text',x:.6,y:.4,w:12.1,h:.9,fontSize:29,text:'첫째 줄\n둘째 줄'}]}]});
test('explicit multiline headings require height for each line, including CRLF and empty lines',()=>{
 for(const text of ['첫째 줄\n둘째 줄','첫째 줄\r\n둘째 줄','첫째 줄\r둘째 줄','첫째 줄\n\n둘째 줄']){
  const p=plan();p.slides[0].elements[0].text=text;assert.throws(()=>validateComposition('powerpoint',p),/composition_text_fit/);
  p.slides[0].elements[0].h=1.5;assert.doesNotThrow(()=>validateComposition('powerpoint',p));
 }
 const p=plan();p.slides[0].elements[0].kind='shape';p.slides[0].elements[0].shape='roundRect';assert.throws(()=>validateComposition('powerpoint',p),/composition_text_fit/);
});
test('the existing host loop receives the exact multiline location and repairs without rebuilding unrelated objects',async()=>{
 const bad=plan(),good=plan();good.slides[0].elements[0].h=1.1;let submissions=0,feedback='';
 const host={id:'contract-test',async complete(messages){
  const results=messages.filter(m=>m.role==='tool');
  if(!results.length)return {content:'',calls:[{id:'read',function:{name:'read_powerpoint_sources',arguments:{}}}]};
  if(results.length<3){submissions++;return {content:'',calls:[{id:'submit-'+submissions,function:{name:'submit_powerpoint_draft',arguments:submissions===1?bad:good}}]};}
  feedback=results[1].content;return {content:'Prepared',calls:[]};
 }};
 const result=await prepareComposition('powerpoint',{request:'두 줄 제목',sources:{}},createHostModelTransport(host),new AbortController().signal);
 assert.equal(submissions,2);assert.equal(result.slides[0].elements[0].h,1.1);assert.match(feedback,/\/slides\/0\/elements\/0/);assert.match(feedback,/2 explicit lines/);
});
