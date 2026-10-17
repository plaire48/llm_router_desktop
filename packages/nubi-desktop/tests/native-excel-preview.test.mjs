import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeExcelPreview} from '../runtime/native-excel-preview.mjs';
const observation={steps:[{action:'get',member:'Worksheets.Item',args:[1],id:'sheet'},{target:'sheet',action:'get',member:'Name'},{target:'sheet',action:'get',member:'Range',args:['B2:C3'],id:'data'},{target:'data',action:'get',member:'Value2'},{target:'sheet',action:'get',member:'Range',args:['D2'],id:'total'},{target:'total',action:'get',member:'Formula'}],results:[{reference:'sheet'},'손익',{reference:'data'},[[10,20],[null,40]],{reference:'total'},'=SUM(B2:C2)']};
test('preview maps actual observed handles and sheet identity to changed cells and expected calculation',()=>{
 const p=nativeExcelPreview(observation,{steps:[{target:'total',action:'set',member:'Formula',value:'=SUM(B2:C3)'}],afterChecks:[{read:{target:'total',action:'get',member:'Value2'},equals:70}]});
 assert.equal(p.sheets[0].name,'손익');assert.deepEqual(p.sheets[0].cells.find(c=>c.address==='B3'),{address:'B3',row:3,col:2,value:null,observed:true});
 const d=p.sheets[0].cells.find(c=>c.address==='D2');assert.equal(d.formula,'=SUM(B2:C3)');assert.equal(d.beforeFormula,'=SUM(B2:C2)');assert.equal(d.expectedValue,70);assert.equal(d.changed,true);assert.equal(p.sheets[0].cells.some(c=>c.address==='A1'),false);
});
test('unknown handles and calls never fabricate cell addresses or full coverage',()=>{
 const p=nativeExcelPreview(observation,{steps:[{target:'invented',action:'set',member:'Value2',value:999},{target:'sheet',action:'call',member:'PivotTables.Add'}]});assert.equal(p.unmappedChanges,2);assert.equal(p.sheets[0].cells.some(c=>c.value===999),false);
});
test('large observed range is bounded and explicitly partial, while formula preview does not pretend it calculated',()=>{
 const p=nativeExcelPreview({steps:[{action:'get',member:'Worksheets.Item.Range.Value2',args:[1,'A1:Z100']}],results:[[[1,2]]]}, {steps:[]});assert.equal(p.partial,true);assert(p.sheets[0].cells.length<=240);assert(!p.sheets[0].cells.some(c=>'expectedValue'in c));
});
test('identical addresses in different worksheets stay separate, including actual blank cells',()=>{
 const p=nativeExcelPreview({steps:[{action:'get',member:'Worksheets.Item',args:[1],id:'one'},{target:'one',action:'get',member:'Range.Value2',args:['A1']},{action:'get',member:'Worksheets.Item',args:[2],id:'two'},{target:'two',action:'get',member:'Range.Value2',args:['A1']}],results:[{reference:'one'},null,{reference:'two'},12]},{steps:[]});assert.equal(p.sheets.length,2);assert.equal(p.sheets[0].cells[0].value,null);assert.equal(p.sheets[1].cells[0].value,12);
});
