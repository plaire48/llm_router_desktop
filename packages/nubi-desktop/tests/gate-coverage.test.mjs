import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const subject=await import('../scripts/check-gate-coverage.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});
const baseline={commands:['npm test','node a.mjs after','node b.mjs'],pretest:'node prepare.mjs'};
const scripts={test:'node --test',pretest:'node prepare.mjs','test:gates':'npm run test:gates:fast && npm run test:gates:electron','test:gates:fast':'npm test && npm run ui',ui:'node a.mjs after','test:gates:electron':'node b.mjs'};
function check(values=scripts){assert.ok(subject,'gate coverage validator must exist');return subject.checkGateCoverage(values,baseline);}
test('the two groups partition the original leaf commands and keep npm pretest',()=>{assert.equal(check().ok,true);assert.equal(check({...scripts,pretest:'node other.mjs'}).ok,false);});
test('a missing or repeated check is rejected rather than hidden by set union',()=>{assert.equal(check({...scripts,'test:gates:electron':''}).ok,false);assert.equal(check({...scripts,'test:gates:electron':'node b.mjs && node b.mjs'}).ok,false);});
test('command arguments are significant and extra checks must be declared',()=>{assert.equal(check({...scripts,ui:'node a.mjs'}).ok,false);assert.equal(check({...scripts,ui:'node a.mjs after && node c.mjs'}).ok,false);});
test('a planned additive gate preserves the original baseline and must be explicitly recorded',()=>{assert.ok(subject);const expanded={...scripts,'test:gates:electron':'node b.mjs && node pilot.mjs'};assert.equal(subject.checkGateCoverage(expanded,{...baseline,additions:['node pilot.mjs']}).ok,true);assert.equal(subject.checkGateCoverage(expanded,baseline).ok,false);});
test('an explicit pretest addition cannot remove or replace the original preparation',()=>{
 const recorded={...baseline,pretestAdditions:['node engine.mjs']};
 assert.equal(subject.checkGateCoverage({...scripts,pretest:'node prepare.mjs && node engine.mjs'},recorded).ok,true);
 assert.equal(subject.checkGateCoverage({...scripts,pretest:'node engine.mjs'},recorded).ok,false);
 assert.equal(subject.checkGateCoverage({...scripts,pretest:'node prepare.mjs && node other.mjs'},recorded).ok,false);
 assert.equal(subject.checkGateCoverage({...scripts,pretest:'node prepare.mjs && node engine.mjs'},baseline).ok,false);
});
test('unknown aliases and cyclic aliases fail without running commands',()=>{assert.throws(()=>check({...scripts,ui:'npm run absent'}),/unknown/);assert.throws(()=>check({...scripts,ui:'npm run ui'}),/cycle/);});
test('actual fast and Electron scripts preserve the frozen P2 gate baseline',async()=>{assert.ok(subject,'gate coverage validator must exist');const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url)));const original=JSON.parse(await readFile(new URL('../scripts/gate-baseline.json',import.meta.url)));assert.equal(subject.checkGateCoverage(pkg.scripts,original).ok,true);});
