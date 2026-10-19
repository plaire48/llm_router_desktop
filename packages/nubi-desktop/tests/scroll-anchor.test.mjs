import test from 'node:test';
import assert from 'node:assert/strict';
import {firstVisibleMessage} from '../ui/scroll-anchor.mjs';
test('prepend anchor finds the first row crossing the viewport with logarithmic layout reads',()=>{
 let reads=0;const rows=Array.from({length:500},(_,i)=>({id:i,getBoundingClientRect(){reads++;return {top:i*20,bottom:(i+1)*20};}}));
 assert.equal(firstVisibleMessage(rows,9980),rows[499]);assert.ok(reads<=10,'offscreen rows must not each force layout');
 assert.equal(firstVisibleMessage(rows,20),rows[1]);assert.equal(firstVisibleMessage(rows,-10),rows[0]);assert.equal(firstVisibleMessage(rows,10000),null);assert.equal(firstVisibleMessage([],0),null);
});
