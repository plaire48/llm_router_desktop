import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storeCaptures,readCapture} from '../runtime/captures.mjs';

const service=()=>{const map=new Map();return {store:{set:(key,value)=>map.set(key,value),get:key=>map.get(key)}};};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test('attached screenshots are stored apart from the task and come back by id',()=>{
  const host=service();
  const stored=storeCaptures(host,'task-1',[{image:png,width:1,height:1}]);
  assert.equal(stored.length,1);assert.deepEqual(Object.keys(stored[0]).sort(),['height','id','width']);
  assert.equal(readCapture(host,stored[0].id).image,png);
  assert.deepEqual(storeCaptures(host,'task-1',[]),[]);
});
test('a capture that is not a PNG payload, has no size or exceeds the count is refused',()=>{
  const host=service();
  assert.throws(()=>storeCaptures(host,'t',[{image:'data:image/png;base64,'+png,width:1,height:1}]),/capture_invalid/);
  assert.throws(()=>storeCaptures(host,'t',[{image:png,width:0,height:1}]),/capture_invalid/);
  assert.throws(()=>storeCaptures(host,'t',[1,2,3,4].map(()=>({image:png,width:1,height:1}))),/capture_invalid/);
  assert.throws(()=>readCapture(host,'missing'),/capture_missing/);
});
