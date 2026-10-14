import test from 'node:test';
import assert from 'node:assert/strict';
import {repairToolArguments} from '../tool-argument-repair.js';
import {toolArgumentIssues} from '../tool-validation.js';

// Same-meaning argument shapes are repaired against the tool's own schema (user report 2026-10-14: tool call format
// failures with Claude). What cannot be repaired without guessing is left for validation to refuse.
const schema={type:'object',additionalProperties:false,required:['items','mode','ids','notes'],properties:{
  items:{type:'array',minItems:1,items:{type:'object',additionalProperties:false,required:['requirementId','method'],properties:{requirementId:{type:'string',minLength:1},method:{type:'string',enum:['test','browser','inspection']},note:{type:'string'}}}},
  mode:{type:'string',enum:['edit','create']},
  ids:{type:'array',minItems:1,items:{type:'string'}},
  notes:{type:'array',items:{type:'string'}},
  limit:{type:'integer'}
}};

test('stringified lists, single values, enum case, snake_case keys and a missing empty list are repaired',()=>{
  const raw={items:JSON.stringify([{requirement_id:7,method:'Browser',note:null}]),mode:'EDIT',ids:'R1'};
  const repaired=repairToolArguments(schema,raw);
  assert.deepEqual(repaired,{items:[{requirementId:'7',method:'browser'}],mode:'edit',ids:['R1'],notes:[]});
  assert.equal(toolArgumentIssues(schema,repaired),null);
  assert.equal(raw.ids,'R1','the proposal itself is not changed');
});

test('a whole argument object sent as a JSON string is read',()=>{
  const repaired=repairToolArguments(schema,JSON.stringify({items:[{requirementId:'R1',method:'test'}],mode:'create',ids:['R1'],notes:[]}));
  assert.equal(toolArgumentIssues(schema,repaired),null);
});

test('values that would need a guess stay as they are and are still refused',()=>{
  const raw={items:[{requirementId:'R1',method:'unit test please'}],mode:'rewrite',ids:['R1'],notes:[],extra:true};
  const repaired=repairToolArguments(schema,raw);
  assert.equal(repaired.mode,'rewrite');assert.equal(repaired.items[0].method,'unit test please');assert.equal(repaired.extra,true);
  assert.ok(toolArgumentIssues(schema,repaired));
});

test('union schemas pick the branch the value already fits or can be repaired into',()=>{
  const union={type:'object',properties:{arguments:{anyOf:[{type:'object'},{type:'string'}]},list:{anyOf:[{type:'array',items:{type:'string'}},{type:'null'}]}}};
  assert.deepEqual(repairToolArguments(union,{arguments:'{"a":1}',list:'["x"]'}),{arguments:'{"a":1}',list:['x']});
});
