import test from 'node:test';
import assert from 'node:assert/strict';
import {frameCoalescer} from '../ui/frame-coalescer.mjs';
test('bursty visual work keeps the latest value once per frame and can schedule the next frame',()=>{
 const pending=new Map(),values=[];let id=0;
 const queue=frameCoalescer(value=>{values.push(value);if(value===99)queue.schedule(100);},{request:callback=>{pending.set(++id,callback);return id;},cancel:id=>pending.delete(id)});
 for(let i=0;i<100;i++)queue.schedule(i);
 assert.equal(pending.size,1);const first=pending.values().next().value;pending.clear();first();assert.deepEqual(values,[99]);assert.equal(pending.size,1);
 const second=pending.values().next().value;pending.clear();second();assert.deepEqual(values,[99,100]);
});
test('cancelling a drag or unmount drops a pending paint without replaying it on the next use',()=>{
 const pending=new Map(),values=[];let id=0;
 const queue=frameCoalescer(value=>values.push(value),{request:callback=>{pending.set(++id,callback);return id;},cancel:id=>pending.delete(id)});
 queue.schedule('cancelled');queue.cancel();assert.equal(pending.size,0);assert.deepEqual(values,[]);
 queue.schedule('new');pending.values().next().value();assert.deepEqual(values,['new']);queue.cancel();
});
