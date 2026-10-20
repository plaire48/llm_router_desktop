import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {createGeneratedFileSession,prepareFileDocument} from '../dist/file-operations.js';
import {createHostModelTransport} from '../dist/host-model.js';
const signal=()=>new AbortController().signal;
async function input(){const b=new ExcelJS.Workbook();b.addWorksheet('Summary').getCell('A1').value='Summary';b.addWorksheet('Scenario').getCell('B5').value=.05;return{domain:'excel',origin:'new_unencrypted_draft',bytes:new Uint8Array(await b.xlsx.writeBuffer())};}
test('explicit Excel sheet/range reaches both initial observation and post-write readback',async()=>{
 const requests=[],session=await createGeneratedFileSession(await input(),{async invoke(r){requests.push(r);return r.action==='read'?{observation:{sheet:r.readScope?.sheet??'Summary'}}:{bytes:r.bytes};}});
 const first=await session.read(signal());assert.equal(first.observation.sheet,'Summary');assert.equal(requests[0].readScope,undefined);
 const options={sheet:'Scenario',range:'A1:D18'},pending=session.read(signal(),options);options.sheet='Summary';const seen=await pending;assert.equal(seen.observation.sheet,'Scenario');
 const result=await session.apply([{op:'set_cell',sheet:'Scenario',address:'B5',value:.1}],seen.revision,signal());assert.equal(result.observation.sheet,'Scenario');assert.deepEqual(requests.at(-1).readScope,{sheet:'Scenario',range:'A1:D18'});session.dispose();
});
test('unknown sheets, unsupported keys and out-of-bounds read ranges never reach the engine',async()=>{
 let calls=0;const session=await createGeneratedFileSession(await input(),{async invoke(){calls++;return{observation:{}};}});
 for(const options of [{sheet:'Missing'},{sheet:1},{path:'/private/secret'},{range:'A1:U1'},{range:'A1:T401'},{range:'[outside.xlsx]Sheet!A1'},{range:1}])await assert.rejects(session.read(signal(),options));
 assert.equal(calls,0);session.dispose();
});
test('the existing file loop exposes scoped Excel reading and uses its observed revision to finish',async()=>{
 const data=await input();let n=0;const transport=createHostModelTransport({id:'contract-test',async complete(messages,tools){
  const call=(name,args)=>({content:'',calls:[{id:'c'+n++,function:{name,arguments:args}}]});
  const prior=messages.filter(m=>m.role==='tool');if(!prior.length){assert.deepEqual(Object.keys(tools.find(t=>t.function.name==='read_file_draft').function.parameters.properties),['sheet','range']);return call('read_file_draft',{sheet:'Scenario',range:'A1:D18'});}
  const result=JSON.parse(prior.at(-1).content);if(prior.length===1)return call('apply_file_operations',{revision:result.revision,ops:[{op:'set_cell',sheet:'Scenario',address:'B5',value:.1}]});
  if(prior.length===2)return call('finish_file_draft',{revision:result.revision});return{content:'Prepared',calls:[]};
 }});
 const result=await prepareFileDocument({...data,request:'Change observed input'}, {async invoke(r){return r.action==='read'?{observation:{sheet:r.readScope?.sheet}}:{bytes:r.bytes};}},transport,signal());assert.equal(result.savedToOffice,false);assert.equal(result.appliedBatches,1);
});
