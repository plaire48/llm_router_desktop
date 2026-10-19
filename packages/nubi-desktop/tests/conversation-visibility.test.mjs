import test from 'node:test';
import assert from 'node:assert/strict';
import {observeConversationVisibility} from '../ui/conversation-visibility.mjs';
test('visibility observations do not rewrite unchanged measured heights on scroll',()=>{
 const original=globalThis.IntersectionObserver;let notify,disconnected=false;
 globalThis.IntersectionObserver=class{constructor(callback){notify=callback;}observe(){}unobserve(){}disconnect(){disconnected=true;}};
 const values=new Map(),writes=[],root={},node={closest:()=>root,style:{getPropertyValue:k=>values.get(k)||'',setProperty(k,v){values.set(k,v);writes.push([k,v]);}},toggleAttribute(){},removeAttribute(){}};
 try{const stop=observeConversationVisibility(node);const emit=height=>notify([{target:node,boundingClientRect:{height},isIntersecting:false}]);
  emit(280);emit(280);assert.equal(writes.length,1,'same observed height must not invalidate descendant styles again');emit(320);assert.equal(writes.length,2);
  assert.equal(values.get('contain-intrinsic-block-size'),'auto 320px','measured size belongs only to this row, not an inherited custom property');stop();assert.ok(disconnected);
 }finally{globalThis.IntersectionObserver=original;}
});
