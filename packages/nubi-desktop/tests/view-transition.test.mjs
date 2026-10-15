import test from 'node:test';
import assert from 'node:assert/strict';
import {transitioned} from '../ui/viewTransition.js';

test('interrupted transition applies pending updates once and preserves order',async()=>{
 const previousDocument=globalThis.document;
 const target=new EventTarget();let callback,finish,skips=0;
 const done=new Promise(resolve=>{finish=resolve;});
 Object.assign(target,{hidden:false,querySelector:()=>null,startViewTransition:run=>{callback=run;return {ready:Promise.resolve(),updateCallbackDone:Promise.resolve(),finished:done,skipTransition:()=>{skips++;}};}});
 globalThis.document=target;
 try{
  const values=[];
  transitioned(()=>values.push('first'));transitioned(()=>values.push('second'));
  await Promise.resolve();
  transitioned(()=>values.push('latest'));
  callback();assert.deepEqual(values,['first','second','latest']);assert.equal(skips,1);
  target.dispatchEvent(new Event('pointerdown'));assert.equal(skips,2);
  finish();await done;await Promise.resolve();
  target.dispatchEvent(new Event('pointerdown'));assert.equal(skips,2,'listeners removed after completion');
  target.startViewTransition=()=>{throw Error('unsupported');};
  transitioned(()=>values.push('fallback'));await Promise.resolve();
  assert.deepEqual(values,['first','second','latest','fallback']);
  target.hidden=true;transitioned(()=>values.push('hidden'));assert.equal(values.at(-1),'hidden');
 }finally{globalThis.document=previousDocument;}
});

test('project switches suppress old-page snapshots even when a transition was queued',async()=>{
 const previousDocument=globalThis.document;let switching=false,snapshots=0,updates=0;
 globalThis.document={hidden:false,documentElement:{hasAttribute:()=>switching},querySelector:()=>null,startViewTransition:()=>{snapshots++;throw Error('must not animate');}};
 try{
  transitioned(()=>updates++);switching=true;await Promise.resolve();
  assert.equal(updates,1);assert.equal(snapshots,0);
  transitioned(()=>updates++);assert.equal(updates,2);assert.equal(snapshots,0);
 }finally{globalThis.document=previousDocument;}
});
