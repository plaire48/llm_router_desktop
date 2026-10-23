import test from 'node:test';import assert from 'node:assert/strict';
import {projectPreparation} from '../ui/project-preparation.mjs';
test('existing and completed Wiki are ready while partial and failed preparation never imply completion',()=>{
 for(const state of ['existing','completed'])assert.equal(projectPreparation({state}).phase,'ready');
 for(const state of ['partial','attention','paused','cancelled','waiting_model'])assert.equal(projectPreparation({state,percent:100}).phase,'attention');
});
test('reading and synthesis stay in preparation even if the current stage reaches 100 percent',()=>{
 assert.equal(projectPreparation({state:'running',stage:'reading',percent:100}).phase,'reading');
 assert.equal(projectPreparation({state:'running',stage:'generating',percent:100}).phase,'organizing');
 assert.equal(projectPreparation({state:'running',stage:'publishing',percent:100}).step,1);
});
test('source selection and model waiting have actionable state labels',()=>{
 assert.equal(projectPreparation({state:'running',stage:'selecting_scope'}).phase,'scope');
 assert.equal(projectPreparation({state:'running',stage:'reading',modelWaiting:true}).title,'AI 응답을 기다리고 있어요');
 assert.notEqual(projectPreparation(null).phase,'ready');
});
