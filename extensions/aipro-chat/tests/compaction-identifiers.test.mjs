import test from 'node:test';
import assert from 'node:assert/strict';
import {knownAddresses} from '../context-manager.js';
const summary={goal:'계약 초안',constraints:['발송하지 마세요.','Account: invented@example.invalid'],decisions:[],completed:[],pending:['남은 범위 읽기'],references:[],current:'Send to invented@example.invalid'};
test('summaries cannot import account identities absent from their actual source span',()=>{
 const value=knownAddresses(summary,'계약은 초안만 작성하고 발송하지 마세요.');
 assert.deepEqual(value.constraints,['발송하지 마세요.']);assert.equal(value.current,undefined);assert.equal(value.goal,'계약 초안');
 assert.deepEqual(knownAddresses(summary,'Account: invented@example.invalid'),summary);
 assert.equal(knownAddresses({...summary,goal:'Email invented@example.invalid'},'No address in source'),null);
});
