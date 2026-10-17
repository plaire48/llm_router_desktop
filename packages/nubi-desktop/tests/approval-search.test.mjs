import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApprovalSearch,emptyApprovalDates} from '../ui/approval-search.mjs';
function fixture({failTitle=false}={}){
 const calls=[];
 const api=async(_,args)=>{calls.push(args);if(args.action==='approvalTitle'){if(failTitle&&args.id==='2')throw Error('mail_portal_unavailable');return {subject:args.id==='3'?'예산 검토':'문서 '+args.id};}
 const items=Array.from({length:2},(_,i)=>({id:String((args.page-1)*2+i),lineId:'line',subject:'결재 문서',titlePending:true,submittedAt:`2026-10-${10+args.page}T12:00:00`,completedAt:args.page===2?'2026-10-15T13:00:00':null}));
 return {items,total:6,hasNext:args.page<3};};
 return {client:createApprovalSearch(api),calls};
}
test('default paging loads only needed server pages and reuses previously loaded pages',async()=>{
 const {client,calls}=fixture();assert.equal((await client.search({size:2})).totalPages,3);assert.equal(calls.length,1);
 assert.deepEqual((await client.search({page:2,size:2})).items.map(r=>r.id),['2','3']);assert.equal(calls.length,2);
 await client.search({size:2});assert.equal(calls.length,2);
 assert.deepEqual((await client.search({page:2,size:4})).items.map(r=>r.id),['4','5']);assert.equal(calls.length,3);
});
test('title search spans later server pages and title cache is shared with visible-row hydration',async()=>{
 const {client,calls}=fixture();const first=await client.search({size:2});await client.title(first.items[0]);
 const result=await client.search({query:'예산',size:2});assert.equal(result.total,1);assert.equal(result.items[0].id,'3');
 assert.equal(calls.filter(c=>c.action==='approvalTitle'&&c.id==='0').length,1);
 await client.search({query:'문서',size:2});assert.equal(calls.filter(c=>c.action==='approvalTitle').length,6);
});
test('date filters are global, missing dates are explicit, and sorting precedes pagination',async()=>{
 const {client,calls}=fixture();const result=await client.search({completed:{...emptyApprovalDates(),period:'custom',from:'2026-10-15',to:'2026-10-15'},sort:'submitted-desc',size:1});assert.equal(result.total,2);assert.equal(result.totalPages,2);
 assert.equal(calls.some(c=>c.action==='approvalTitle'),false,'date-only search must not download document bodies');
 assert.equal((await client.search({completed:{...emptyApprovalDates(),period:'unknown'}})).total,4);
 assert.equal((await client.search({sort:'submitted-desc',size:2})).items[0].id,'4');
});
test('failed title reads are reported instead of claiming complete search coverage',async()=>{
 const {client}=fixture({failTitle:true});const result=await client.search({query:'예산'});assert.equal(result.total,1);assert.equal(result.unavailable,1);
});
test('repeated server page fails rather than looping or claiming the full list',async()=>{
 let calls=0;const client=createApprovalSearch(async()=>{calls++;return {items:[{id:'same',lineId:'x'}],hasNext:true,total:40};});
 await assert.rejects(client.search({query:'test'}),/mail_portal_format/);assert.equal(calls,2);
});
test('superseded search stops before the next request and newer search can proceed',async()=>{
 const {client,calls}=fixture();let cancel=false;
 await assert.rejects(client.search({query:'예산'},()=>{cancel=true;},()=>cancel),/mail_cancelled/);
 assert.equal(calls.length,1);assert.equal((await client.search({size:2})).items.length,2);assert.equal(calls.length,1);
});
