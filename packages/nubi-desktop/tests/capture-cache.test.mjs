import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCaptureCache} from '../ui/capture-cache.mjs';
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
test('preview reads join in flight, handle synchronous errors and allow explicit retry',async()=>{
 const cache=createCaptureCache();let calls=0,fail=true;
 cache.configure(()=>{calls++;if(fail)throw Error('offline');return {image};});
 assert.deepEqual(await Promise.all([cache.load('a'),cache.load('a')]),[null,null]);assert.equal(calls,1);
 fail=false;assert.equal(await cache.load('a'),'data:image/png;base64,'+image);assert.equal(calls,2);
 assert.equal(await cache.load('a'),'data:image/png;base64,'+image);assert.equal(calls,2);
});
test('a timed-out read never retries itself or overwrites the explicit retry',async()=>{
 const cache=createCaptureCache({timeoutMs:10});let resolve,calls=0;
 cache.configure(()=>++calls===1?new Promise(r=>resolve=r):{image});
 assert.equal(await cache.load('a'),null);assert.equal(calls,1);
 const retry=await cache.load('a');resolve({image:image+'old'});await Promise.resolve();
 assert.equal(await cache.load('a'),retry);assert.equal(calls,2);
});
test('switching reader discards late old-reader data for the same ID',async()=>{
 const cache=createCaptureCache();let resolve;
 cache.configure(()=>new Promise(r=>resolve=r));const old=cache.load('a');await Promise.resolve();
 let calls=0;cache.configure(()=>{calls++;return {image};});const fresh=await cache.load('a');
 resolve({image:image+'old'});assert.equal(await old,null);assert.equal(await cache.load('a'),fresh);assert.equal(calls,1);
});
test('retained image data is bounded by character budget as well as item count',async()=>{
 const value='data:image/png;base64,'+image,cache=createCaptureCache({maxEntries:2,maxChars:value.length+1});const calls=[];
 cache.configure((method,{id})=>{calls.push(id);return {image};});
 await cache.load('a');await cache.load('b');await cache.load('b');await cache.load('a');assert.deepEqual(calls,['a','b','a']);
});
test('invalid image payloads do not poison the next preview read',async()=>{
 const cache=createCaptureCache();let invalid=true;cache.configure(()=>invalid?{}:{image});
 assert.equal(await cache.load('a'),null);invalid=false;assert.equal(await cache.load('a'),'data:image/png;base64,'+image);
});
