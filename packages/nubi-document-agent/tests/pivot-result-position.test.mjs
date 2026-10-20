import test from'node:test';import assert from'node:assert/strict';import{pivotResultPosition}from'../scripts/univer-pivot-function.mjs';
const definition={unsupported:[],outputRef:'H50:I53',firstDataRow:1,firstDataCol:1,fields:[{name:'Name'},{name:'Sales'}],dataFields:[{name:'Sum Sales',field:1}],rowFields:[0],colFields:[],pageFields:[],rowLines:[{predicates:[{field:0,key:'a'}]},{predicates:[{field:0,key:'b'}]},{predicates:[]}],colLines:[{predicates:[]}]},api={parseRange:()=>({startRow:49,endRow:52,startColumn:7,endColumn:8}),groupKey:s=>s.toLowerCase(),linePredicates:(_d,_fields,line)=>({predicates:line.predicates,dataField:0})};
test('pivot lookup distinguishes a member, grand total, missing field and ambiguous request',()=>{
 assert.deepEqual(pivotResultPosition(definition,{dataField:'Sales',items:[['Name','A']]},api),{row:0,column:0});assert.deepEqual(pivotResultPosition(definition,{dataField:'Sum Sales',items:[]},api),{row:2,column:0});assert.equal(pivotResultPosition(definition,{dataField:'Unknown',items:[]},api),null);assert.equal(pivotResultPosition(definition,{dataField:'Sales',items:[['Name','A'],['Name','B']]},api),null);
});
test('pivot lookup rejects an expanded body whose saved layout has not been rebuilt',()=>{
 assert.equal(pivotResultPosition({...definition,rowLines:definition.rowLines.slice(0,2)},{dataField:'Sales',items:[['Name','A']]},api),null);
});
