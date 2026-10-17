import test from 'node:test';
import assert from 'node:assert/strict';
import {contextProgressLabel} from '../ui/context-progress.mjs';
test('history organization and active context compaction have separate live draft and review labels',()=>{
 assert.equal(contextProgressLabel({phase:'summarizing',operation:'context',stage:'draft'}),'컨텍스트 압축 중');
 assert.equal(contextProgressLabel({phase:'summarizing',operation:'history',stage:'draft'}),'대화 내용 정리 중');
 assert.equal(contextProgressLabel({phase:'summarizing',operation:'context',stage:'review'}),'컨텍스트 압축 검토 중');
 assert.equal(contextProgressLabel({phase:'summarizing',operation:'history',stage:'review'}),'대화 내용 정리 검토 중');
 for(const phase of ['ready','failed','cancelled'])assert.equal(contextProgressLabel({phase,stage:'review'}),null);
});
