import test from 'node:test';
import assert from 'node:assert/strict';
import {readChatDocument} from '../runtime/chat-documents.mjs';
import {contextTokens} from '../../../extensions/aipro-chat/context-manager.js';
const measure=value=>contextTokens([{role:'tool',content:JSON.stringify(value)}]);
function fixture(segments){
 const text='계약금액은100원이며자동전송하지않는다.😀\n'.repeat(1000),record={id:'doc',projectId:'project',hash:'a'.repeat(64),filename:'large.txt',bytes:100000,text,segments:segments?.(text)||[],coverage:'synthetic text'};
 return {record,service:{projectId:'project',store:{get:()=>structuredClone(record)}},args:{id:'doc',sourceHash:record.hash}};
}
test('model document body appears once with bounded page locators and immutable original',()=>{
 const {record,service,args}=fixture(text=>[{page:1,text:text.slice(0,12000)}]),before=structuredClone(record);
 const value=readChatDocument(service,{...args,limit:12000,room:30000});
 assert.equal(value.segments[0].text,undefined);
 assert.equal(value.segments[0].start,0);assert(value.segments[0].end<=value.text.length);
 assert.equal(value.text,record.text.slice(0,value.nextOffset));assert.deepEqual(record,before);
});
test('a Korean read fits the whole serialized result budget and resumes with no gaps or broken surrogate pairs',()=>{
 const {record,service,args}=fixture();let offset=0,read='';
 do{const result=readChatDocument(service,{...args,offset,room:1200});assert(measure(result)<=1200);assert(!/[\uD800-\uDBFF]$/.test(result.text));assert(result.text.length>0);read+=result.text;offset=result.nextOffset;}while(offset!==null);
 assert.equal(read,record.text);
});
test('unlocated segment bodies cannot bypass a bounded document read',()=>{
 const {service,args}=fixture(()=>Array.from({length:120},(_,i)=>({page:i+1,text:'UNLOCATED '+i+'다'.repeat(1200)})));
 const result=readChatDocument(service,{...args,room:2400});
 assert(measure(result)<=2400);assert.equal(result.unlocatedSegments,120);assert.equal(result.segments.length,0);assert.equal(result.partial,true);
});
test('insufficient room defers the read without claiming any coverage',()=>{
 const {service,args}=fixture();const result=readChatDocument(service,{...args,room:10});
 assert.equal(result.deferred,true);assert.equal(result.actionIssued,false);assert.equal(result.text,undefined);assert.equal(result.nextOffset,0);
});
test('an unlocated extraction segment stays separately readable under the original snapshot hash',()=>{
 const {service,args}=fixture(()=>[{page:8,text:'위치 미확인 원문입니다. '.repeat(100)}]);
 const result=readChatDocument(service,{...args,segmentIndex:0,room:2400});
 assert.equal(result.segmentIndex,0);assert.match(result.text,/위치 미확인 원문입니다/);assert.equal(result.locationVerified,false);
 assert.throws(()=>readChatDocument(service,{...args,segmentIndex:1}),/document_segment_missing/);
});
