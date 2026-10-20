import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {createGeneratedFileSession} from '../dist/file-operations.js';

const signal=()=>new AbortController().signal;
async function session(rows){
 const book=new ExcelJS.Workbook(),s=book.addWorksheet('Data');
 for(const [address,value]of rows)s.getCell(address).value=value;
 const bytes=new Uint8Array(await book.xlsx.writeBuffer());let writes=0;
 const value=await createGeneratedFileSession({domain:'excel',origin:'new_unencrypted_draft',bytes},{async invoke(r){if(r.action==='read')return{observation:{}};writes++;return{bytes:r.bytes};}});
 const seen=await value.read(signal());return{value,seen,writes:()=>writes};
}
test('editing a small actual sheet does not multiply whole-column dependencies across 400 invented rows',async()=>{
 const rows=[['A1',1],['L1',3],...Array.from({length:100},(_,i)=>['B'+(i+1),{formula:'SUM(A:A,D:L)'}])];
 const s=await session(rows);await s.value.apply([{op:'set_cell',sheet:'Data',address:'A1',value:2}],s.seen.revision,signal());assert.equal(s.writes(),1);s.value.dispose();
});
test('new targets extend dependency shapes before analyzing original blank-cell references',async()=>{
 const s=await session([['A1',{formula:'SUM(B:B)'}]]);
 await assert.rejects(s.value.apply([{op:'set_formula',sheet:'Data',address:'B400',formula:'A1'}],s.seen.revision,signal()),{code:'excel_formula_invalid'});assert.equal(s.writes(),0);s.value.dispose();
});
test('real dependency graphs above 250000 edges still reject before engine dispatch',async()=>{
 const rows=Array.from({length:400},(_,i)=>['A'+(i+1),1]);rows.push(...Array.from({length:400},(_,i)=>['B'+(i+1),{formula:'SUM(A:A)'}]),...Array.from({length:226},(_,i)=>['C'+(i+1),{formula:'SUM(A:A)'}]));
 const s=await session(rows);await assert.rejects(s.value.apply([{op:'set_cell',sheet:'Data',address:'A1',value:2}],s.seen.revision,signal()),{code:'excel_formula_invalid'});assert.equal(s.writes(),0);s.value.dispose();
});
