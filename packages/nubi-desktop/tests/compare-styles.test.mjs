// CSS refactors are judged on computed styles, which are immune to pointer position (plan 2a): every element's computed
// style at each capture, before and after, must match apart from animation phase.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {compareStyleSnapshots,ANIMATION_PHASE_PROPERTIES} from '../scripts/compare-styles.mjs';
import {removeLater} from './helpers-cleanup.mjs';
const snap=elements=>JSON.stringify(elements.map(([tag,style])=>({tag,cls:'',style})));
test('real property changes are reported per capture; animation phase is ignored; missing captures are reported',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-styles-'));removeLater(root);const a=path.join(root,'a'),b=path.join(root,'b');await mkdir(a);await mkdir(b);
 await writeFile(path.join(a,'one.json'),snap([['DIV',{color:'red',transform:'matrix(1,0,0,1,0,0)'}]]));
 await writeFile(path.join(b,'one.json'),snap([['DIV',{color:'blue',transform:'matrix(1,0,0,1,3,0)'}]]));
 await writeFile(path.join(a,'two.json'),snap([['P',{color:'red'}]]));
 const result=await compareStyleSnapshots(a,b);
 assert.deepEqual(result.changed,[{capture:'one.json',element:0,tag:'DIV',property:'color',before:'red',after:'blue'}]);
 assert.deepEqual(result.missing,['two.json']);
 assert.ok(ANIMATION_PHASE_PROPERTIES.has('transform')&&ANIMATION_PHASE_PROPERTIES.has('opacity'));
});
test('a different element count is reported instead of comparing shifted elements',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-styles-'));removeLater(root);const a=path.join(root,'a'),b=path.join(root,'b');await mkdir(a);await mkdir(b);
 await writeFile(path.join(a,'one.json'),snap([['DIV',{}],['P',{}]]));await writeFile(path.join(b,'one.json'),snap([['DIV',{}]]));
 assert.deepEqual((await compareStyleSnapshots(a,b)).structure,[{capture:'one.json',before:2,after:1}]);
});
