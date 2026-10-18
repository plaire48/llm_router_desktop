import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateTemplate,evaluateCondition,evaluateExpression} from '../runtime/workflow-template.mjs';
const scope={inputs:{ticket:'CR-12',empty:'',count:2},steps:{ok:{output:{decision:'approve'}}}};
test('templates support own paths, literals and the five whitelisted filters',()=>{
  assert.equal(evaluateTemplate('티켓 {{ inputs.ticket | lower }}',scope),'티켓 cr-12');
  assert.equal(evaluateTemplate('{{ inputs.missing | default("없음") }}',scope),'없음');
  assert.equal(evaluateTemplate('{{ "  nubi  " | trim | upper }}',scope),'NUBI');
  assert.equal(evaluateTemplate('{{ inputs.count | json }}',scope),'2');
  assert.equal(evaluateTemplate('{{ inputs.empty | default("대기") }}',scope),'대기');
  assert.equal(evaluateTemplate('{{ inputs.missing }}',scope),'');
});
test('conditions honor boolean precedence, parentheses and strict comparisons',()=>{
  assert.equal(evaluateCondition("steps.ok.output.decision == 'approve' && !inputs.missing",scope),false);
  assert.equal(evaluateCondition('false || true && false',scope),false);
  assert.equal(evaluateCondition('(false || true) && inputs.count != 3',scope),true);
  assert.equal(evaluateExpression('inputs.count == "2"',scope),false);
  assert.equal(evaluateExpression('null',scope),null);
});
test('arbitrary code, prototype access and malformed expressions are refused',()=>{
  for(const expr of ['process.exit(1)','inputs.ticket.constructor','require("fs")','inputs.__proto__','inputs.prototype',
    'inputs["ticket"]','inputs.count + 1','inputs.ticket | jsmUrl','true trailing','true || require("fs")',
    'inputs.ticket | default("x", "y")','inputs.ticket | lower("x")']){
    assert.throws(()=>evaluateTemplate('{{ '+expr+' }}',scope),/template_invalid/,expr);
  }
  assert.equal(evaluateTemplate('{{ inherited }}',Object.create({inherited:'hidden'})),'');
  for(const text of ['{{ inputs.ticket','inputs.ticket }}','{{ }}'])assert.throws(()=>evaluateTemplate(text,scope),/template_invalid/);
});
test('expressions never execute accessor properties or exceed nesting limits',()=>{
  const value={};Object.defineProperty(value,'unsafe',{get(){throw new Error('executed');}});
  assert.throws(()=>evaluateExpression('unsafe',value),/template_invalid/);
  assert.throws(()=>evaluateExpression('('.repeat(300)+'true'+')'.repeat(300),scope),/template_invalid/);
});
