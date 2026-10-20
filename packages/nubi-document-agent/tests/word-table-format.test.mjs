import {test} from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {composeWord,validateComposition} from '../dist/composition.js';
const plan=()=>({title:'검수',blocks:[{kind:'table',widths:[1.6,2.4,2.2,2.1,1.8,2.4,2.4,2.1],headers:['A','B','C','D','E','F','G','H'],rows:[['1','2','3','4','5','6','7','8']]}]});
test('a mathematical 17cm table is accepted despite binary summation noise, while real overflow stays rejected',()=>{
 const p=plan();assert(p.blocks[0].widths.reduce((a,b)=>a+b,0)>17);assert.doesNotThrow(()=>validateComposition('word',p));
 p.blocks[0].widths[0]+=.0001;assert.throws(()=>validateComposition('word',p),/composition_table_width/);
});
test('schema-exposed table paragraph spacing reaches the existing GenOffice XML writer in point units',async()=>{
 const p=plan();Object.assign(p.blocks[0],{widths:[2,2,2,2,2,2,2,2],lineSpacing:1.2,spaceBefore:2,spaceAfter:3,fontSize:11});
 const result=await composeWord(p,new AbortController().signal);const zip=await JSZip.loadAsync(result.bytes),xml=await zip.file('word/document.xml').async('string');
 assert.match(xml,/<w:spacing[^>]*w:before="40"/);assert.match(xml,/<w:spacing[^>]*w:after="60"/);assert.match(xml,/<w:spacing[^>]*w:line="288"/);
 for(const [key,value]of [['spaceBefore',-1],['spaceAfter',37],['lineSpacing',.5]]){const bad=structuredClone(p);bad.blocks[0][key]=value;assert.throws(()=>validateComposition('word',bad),/composition_invalid/);}
});
