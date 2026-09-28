import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {readFile} from 'node:fs/promises';
import {contentOperation} from '../worker/content-schema.mjs';

const snapshot={created:true,items:[{id:'p1',kind:'paragraph',editable:true},{id:'s1',kind:'slide',editable:true},
  {id:'cc1',kind:'field',editable:true,controlType:1,mapped:false,locked:false,temporary:false,nested:false}]};
const cases=JSON.parse(await readFile(new URL('../eval/operation-repair-cases.json',import.meta.url),'utf8'));
for(const [host,operation,path] of cases)test(`${host} invalid ${operation.type} diagnoses ${path} before Office`,()=>{
  const before=structuredClone(operation);
  assert.throws(()=>contentOperation(host,operation,snapshot),error=>{
    assert.ok(['document_schema_invalid','unsupported_operation'].includes(error.message));
    assert.equal(error.toolFailure.actionIssued,false);assert.equal(error.toolFailure.argument,'plan');
    assert.ok(error.toolFailure.issues.some(issue=>issue.path===path));
    assert.ok(error.toolFailure.expectedSchema);return true;
  });
  assert.deepEqual(operation,before);
});
test('malformed JSON and arbitrary properties do not leak rejected values through diagnostics',()=>{
  for(const input of ['{"private":"secret-value",',JSON.stringify({type:'append_paragraph',text:'private-value',style:'Normal','secret-property':'private-token'})]){
    assert.throws(()=>contentOperation('word',input,snapshot),error=>{
      const feedback=JSON.stringify(error.toolFailure);assert.ok(feedback);
      for(const secret of ['secret-value','private-value','secret-property','private-token'])assert.equal(feedback.includes(secret),false);
      assert.ok(error.toolFailure.issues.length<=4);return true;
    });
  }
});
test('schema feedback is detached and never grants scope or editable rights',()=>{
  let feedback;try{contentOperation('word',cases[0][1],snapshot);}catch(error){feedback=error.toolFailure;}
  feedback.expectedSchema.properties.style.enum.push('heading');
  assert.throws(()=>contentOperation('word',cases[0][1],snapshot),/document_schema_invalid/);
  assert.throws(()=>contentOperation('word',{type:'append_paragraph',text:'보고',style:'Normal'},{...snapshot,created:false}),/out_of_scope/);
  assert.throws(()=>contentOperation('word',{type:'fill_field',targetId:'cc1',text:'값'},{...snapshot,items:[{...snapshot.items[2],mapped:true}]}),/unsupported_target/);
  assert.throws(()=>contentOperation('powerpoint',{type:'replace_text',targetId:'p1',text:'값'},snapshot),/unsupported_target/);
});
test('fast-check: valid single-line Unicode stays exact and every appended control is rejected',()=>{
  fc.assert(fc.property(fc.string({maxLength:150}).filter(s=>s.trim()&&!/[\r\n\u0000-\u001f]/.test(s)),fc.integer({min:0,max:31}),(value,control)=>{
    const op={type:'replace_text',targetId:'p1',text:value};
    assert.deepEqual(contentOperation('word',op,snapshot),op);
    assert.throws(()=>contentOperation('word',{...op,text:value+String.fromCharCode(control)},snapshot),error=>error.toolFailure.issues.some(issue=>issue.path==='/text'));
  }),{seed:9252026,numRuns:150});
});
