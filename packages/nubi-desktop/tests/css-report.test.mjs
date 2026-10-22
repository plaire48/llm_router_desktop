// CSS diet measurements (plan 2a): which rules every element must check, and where the bytes come from.
import test from 'node:test';
import assert from 'node:assert/strict';
import {selectorBuckets,cssReport} from '../scripts/css-report.mjs';
test('rightmost :is(), *, attribute-only and :root are universal; a class anywhere in the last compound keys it',()=>{
 const b=selectorBuckets('.a :is(.b,.c){x:1} .a *{x:1} [role=tab]{x:1} :root{x:1} .a .b:hover{x:1} button{x:1} #i{x:1} .a > .b:is(.c){x:1}');
 assert.deepEqual([b.universal,b.classKeyed,b.tagKeyed,b.idKeyed],[4,2,1,1]);
 assert.equal(b.selectors,8);
});
test('selector lists, keyframes and comments are counted correctly',()=>{
 const b=selectorBuckets('/* .x{} */ .a,.b span{x:1} @keyframes k{from{x:0}to{x:1}} @media (min-width:1px){.c{x:1}}');
 assert.deepEqual([b.selectors,b.classKeyed,b.tagKeyed],[3,2,1]);
});
test('bytes per source come from the esbuild metafile',()=>{
 const metafile={outputs:{'out/app.css':{bytes:300,inputs:{'design/a.css':{bytesInOutput:200},'ui/b.css':{bytesInOutput:100}}},'out/chunks/x.css':{bytes:50,inputs:{'ui/c.css':{bytesInOutput:50}}},'out/app.js':{bytes:999,inputs:{}}}};
 const r=cssReport({metafile,main:'out/app.css',css:'.a{x:1}'});
 assert.equal(r.mainBytes,300);assert.equal(r.chunkBytes,50);assert.deepEqual(r.bySource,{'design/a.css':200,'ui/b.css':100});assert.equal(r.buckets.classKeyed,1);
});
