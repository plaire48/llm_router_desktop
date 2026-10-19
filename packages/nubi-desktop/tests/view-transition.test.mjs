import test from 'node:test';
import assert from 'node:assert/strict';
import {transitioned} from '../ui/viewTransition.js';

test('capture timing is read before phase writes and snapshot capture can invalidate styles',async()=>{
 const previousDocument=globalThis.document,previousStyle=globalThis.getComputedStyle,target=new EventTarget(),events=[];
 const attributes=new Set();let finish;
 const finished=new Promise(resolve=>{finish=resolve;});
 Object.assign(target,{hidden:false,documentElement:{hasAttribute:name=>attributes.has(name),setAttribute(name){attributes.add(name);events.push('phase-write');},removeAttribute(name){attributes.delete(name);}},querySelector:()=>null,
  startViewTransition(run){events.push('snapshot');run();return {ready:Promise.resolve(),updateCallbackDone:Promise.resolve(),finished,skipTransition(){}};}});
 globalThis.document=target;globalThis.getComputedStyle=()=>({getPropertyValue(name){events.push('timing-read');assert.equal(name,'--nubi-motion-capture');return '120ms';}});
 try{
  transitioned(()=>events.push('update'));await Promise.resolve();
  assert.equal(events.filter(event=>event==='timing-read').length,1);
  assert.ok(events.indexOf('timing-read')<events.indexOf('phase-write'),'a token read after a phase mutation forces a document-wide style flush');
  assert.ok(events.indexOf('timing-read')<events.indexOf('snapshot'),'capture must not introduce a synchronous computed-style read');
 }finally{
  finish();await finished;await Promise.resolve();globalThis.document=previousDocument;
  if(previousStyle===undefined)delete globalThis.getComputedStyle;else globalThis.getComputedStyle=previousStyle;
 }
});

test('new input commits a pending transition update immediately, without waiting for its capture callback',async()=>{
 const previousDocument=globalThis.document,target=new EventTarget();let callback,finish,updates=0;
 const finished=new Promise(resolve=>{finish=resolve;});
 Object.assign(target,{hidden:false,querySelector:()=>null,startViewTransition:run=>{callback=run;return {ready:Promise.resolve(),updateCallbackDone:Promise.resolve(),finished,skipTransition(){}};}});
 globalThis.document=target;
 try{
  transitioned(()=>updates++);await Promise.resolve();assert.equal(updates,0);
  target.dispatchEvent(new Event('pointerdown'));assert.equal(updates,1);
  callback();assert.equal(updates,1,'the delayed browser callback never replays the update');finish();await finished;await Promise.resolve();
 }finally{globalThis.document=previousDocument;}
});

test('a stalled snapshot falls back to the live update within a bounded capture budget',async()=>{
 const previousDocument=globalThis.document,target=new EventTarget();let callback,finish,updates=0,skips=0;
 const finished=new Promise(resolve=>{finish=resolve;});
 Object.assign(target,{hidden:false,querySelector:()=>null,startViewTransition:run=>{callback=run;return {ready:new Promise(()=>{}),updateCallbackDone:new Promise(()=>{}),finished,skipTransition(){skips++;}};}});
 globalThis.document=target;
 try{
  transitioned(()=>updates++);await Promise.resolve();await new Promise(resolve=>setTimeout(resolve,180));
  assert.equal(updates,1,'a compositor capture cannot hold the requested screen update indefinitely');assert.equal(skips,1);
  callback();assert.equal(updates,1);finish();await finished;await Promise.resolve();
 }finally{finish();globalThis.document=previousDocument;}
});

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
