import {test} from 'node:test';
import assert from 'node:assert/strict';
import {composeExcel,prepareComposition} from '../dist/composition.js';
import {inspectGeneratedExcel} from '../dist/excel.js';
import {createHostModelTransport} from '../dist/host-model.js';
const plan=()=>({title:'빈 문자열',sheets:[{name:'집계',widths:[20,20,20],cells:[{address:'A1',value:'',role:'header'},{address:'B1',value:'=SUM(1,2)'},{address:'C1',value:null}]}],outputs:[]});
test('empty text and literal equals strings remain typed values rather than formulas or rejected drafts',async()=>{
 const p=plan(),before=structuredClone(p);const built=await composeExcel(p,{},new AbortController().signal),read=await inspectGeneratedExcel(built.bytes);
 assert.deepEqual(p,before);assert.equal(read.sheets[0].rows[0][0].value,'');assert.equal(read.sheets[0].rows[0][1].value,'=SUM(1,2)');assert.equal(read.sheets[0].rows[0][1].formula,null);
});
test('invalid worksheet names return the exact observed plan field to the existing model',async()=>{
 const bad=plan(),good=plan();bad.sheets[0].name='집계/잘못된이름';let count=0,feedback='';
 const transport=createHostModelTransport({id:'contract-test',async complete(messages){const tools=messages.filter(m=>m.role==='tool');if(!tools.length)return {content:'',calls:[{id:'read',function:{name:'read_excel_sources',arguments:{}}}]};if(tools.length<3){count++;return {content:'',calls:[{id:'submit-'+count,function:{name:'submit_excel_draft',arguments:count===1?bad:good}}]};}feedback=tools[1].content;return {content:'Prepared',calls:[]};}});
 await prepareComposition('excel',{request:'빈 셀을 보존한다',sources:{}},transport,new AbortController().signal,{datasets:{}});
 assert.equal(count,2);assert.match(feedback,/\/sheets\/0\/name/);
});
