import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultOfficeModel} from '../../nubi-office/worker/providers.mjs';

test('AI Pro starts on a GLM model when the catalog has one, else Qwen 3.8 27B, else the first listed (user decision 2026-10-14)',()=>{
  assert.equal(defaultOfficeModel([{id:'aipro-fast'},{id:'QWEN3.8-27B-FP8-256K'},{id:'GLM-5.2-NVFP4',label:'glm-5.2'}]),'GLM-5.2-NVFP4');
  assert.equal(defaultOfficeModel([{id:'x',label:'GLM 5.2 chat'},{id:'qwen3.8-27b'}]),'x');
  assert.equal(defaultOfficeModel([{id:'aipro-fast'},{id:'qwen3.8-27b'}]),'qwen3.8-27b');
  assert.equal(defaultOfficeModel([{id:'only'}]),'only');
  assert.equal(defaultOfficeModel([{id:'glmfoo-not-a-word'},{id:'qwen3.8-27b'}]),'qwen3.8-27b');
});
