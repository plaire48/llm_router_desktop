import test from'node:test';import assert from'node:assert/strict';import{trackFormulaErrors}from'../scripts/univer-formula-results.mjs';
test('formula error typing survives Univer flattening without misclassifying identical text',()=>{
 const received=[],runtime={currentSubUnitId:'s',currentRow:2,currentColumn:3,setRuntimeData(value){received.push(value);}},original=runtime.setRuntimeData,tracked=trackFormulaErrors(runtime),error={isError:()=>true,getErrorType:()=>'#N/A'},text={isError:()=>false,getValue:()=>'#N/A'};
 runtime.setRuntimeData(error);assert.equal(tracked.errors.get('s:2:3'),'#N/A');runtime.setRuntimeData(text);assert.equal(tracked.errors.has('s:2:3'),false);assert.deepEqual(received,[error,text]);tracked.dispose();assert.equal(runtime.setRuntimeData,original);
});
