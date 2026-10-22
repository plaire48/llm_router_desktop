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
// Plan 2a task 3: the CX stylesheet also carries another product's screens; rules naming classes the Desktop never
// renders are dropped at build time. A class is kept when its exact name appears in the sources or when a name-building
// prefix (`is-`+state, `message-${role}`) in the sources starts it.
import {usedClassTokens,pruneUnusedCxRules} from '../scripts/cx-reference-css.mjs';
test('names and name-building prefixes are collected from sources',()=>{
 const used=usedClassTokens(["<b className={'nubi-action is-'+state}/>","`message message-${role}`","const k='cx-button'"]);
 for(const name of ['nubi-action','message','cx-button'])assert.ok(used.exact.has(name),name);
 assert.ok(used.prefixes.has('is-'));assert.ok(used.prefixes.has('message-'));
});
test('a rule goes only when every selector names an unused class; prefixes, keyframes and root variables stay',async()=>{
 const used={exact:new Set(['cx-button','app-shell']),prefixes:new Set(['cx-button--','is-'])};
 const out=await pruneUnusedCxRules('.cx-button{a:1}.cx-button--primary{a:1}.admin-table{a:1}.admin-table,.cx-button{a:1}.x.is-open{a:1}@media (min-width:1px){.admin-row{a:1}.app-shell{a:1}}@keyframes cx-spin{to{a:1}}:root{--cx-x:1}button{a:1}',used);
 assert.equal(out.removed,3);
 for(const kept of ['.cx-button{','.cx-button--primary','.admin-table,.cx-button','.app-shell','cx-spin','--cx-x','button{'])assert.ok(out.css.includes(kept),kept);
 assert.ok(!out.css.includes('.admin-table{a:1}'));assert.ok(!out.css.includes('.admin-row'));assert.ok(!out.css.includes('.x.is-open'),'x is not used even though is- is');
});
test(':is() and :where() alternatives need only one used class; classes under :not() need none',async()=>{
 const used={exact:new Set(['cx-detail-panel','card']),prefixes:new Set()};
 const out=await pruneUnusedCxRules(':is(.app-shell,.cx-detail-panel) summary:focus-visible{a:1}:where(.admin,.login) a{a:1}.card:not(.admin-only){a:1}.card :is(.x,.y){a:1}',used);
 assert.ok(out.css.includes(':is(.app-shell,.cx-detail-panel) summary:focus-visible'),'one used alternative keeps it');
 assert.ok(out.css.includes('.card:not(.admin-only)'),'a negated class need not be used');
 assert.ok(!out.css.includes(':where(.admin,.login) a'));assert.ok(!out.css.includes('.card :is(.x,.y)'));
 assert.equal(out.removed,2);
});
