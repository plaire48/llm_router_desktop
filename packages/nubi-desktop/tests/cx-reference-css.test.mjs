import test from 'node:test';import assert from 'node:assert/strict';import {readFile,readdir} from 'node:fs/promises';
import {pruneUnusedFlowPreviewRules} from '../scripts/cx-reference-css.mjs';
test('only four unused reference Flow expansion rules are pruned',async()=>{
 const css=await readFile(new URL('../node_modules/@e2e/cx-design-system/dist/styles.css',import.meta.url),'utf8'),pruned=pruneUnusedFlowPreviewRules(css),rules=css.match(/\.flow-assessment-panel[^{}]*:has\([^{}]*\)[^{}]*\{[^{}]*\}/g);
 assert.equal(rules.length,4);assert.equal(pruned.length,css.length-rules.join('').length);assert.ok(!pruned.includes('.cx-panel-body:has(>.flow-preview.is-expanded)'));
 const other='button:disabled{opacity:.5} .other:has(.child){display:block}';assert.equal(pruneUnusedFlowPreviewRules(other),other);
});
test('no distributed CX component or product UI owns that reference Flow screen',async()=>{
 const component=await readFile(new URL('../node_modules/@e2e/cx-design-system/dist/index.js',import.meta.url),'utf8');assert.ok(!component.includes('flow-assessment-panel'));
 for(const file of await readdir(new URL('../ui/',import.meta.url)))if(/\.(jsx|js|mjs)$/.test(file))assert.ok(!(await readFile(new URL('../ui/'+file,import.meta.url),'utf8')).includes('flow-assessment-panel'),file+' consumes pruned CSS');
});
