import test from 'node:test';
import assert from 'node:assert/strict';
import {listFrames,installListMotion} from '../ui/motion-list.mjs';
test('list entrance and exit use only the explicit height exception and opacity',()=>{
 assert.deepEqual(listFrames(44,true,false),[{height:'0px',opacity:0},{height:'44px',opacity:1}]);
 assert.deepEqual(listFrames(44,false,false),[{height:'44px',opacity:1},{height:'0px',opacity:0}]);
});
test('removing a navigation subtree releases every observed row',()=>{
 const saved={ResizeObserver:globalThis.ResizeObserver,MutationObserver:globalThis.MutationObserver,matchMedia:globalThis.matchMedia},observed=new Set();let mutate;
 globalThis.matchMedia=()=>({matches:false});globalThis.ResizeObserver=class{observe(row){observed.add(row);}unobserve(row){observed.delete(row);}disconnect(){observed.clear();}};globalThis.MutationObserver=class{constructor(callback){mutate=callback;}observe(){}disconnect(){}};
 const row={isConnected:false},nav={matches:()=>false,querySelectorAll:()=>[row]},root={isConnected:true,querySelectorAll:()=>[row]};
 try{const stop=installListMotion(root);assert.equal(observed.size,1);mutate([{target:root,removedNodes:[nav],addedNodes:[]}]);assert.equal(observed.size,0);stop();}
 finally{for(const[key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});
test('reduced list changes keep natural geometry and only crossfade',()=>{
 assert.deepEqual(listFrames(44,true,true),[{opacity:0},{opacity:1}]);
 assert.deepEqual(listFrames(44,false,true),[{opacity:1},{opacity:0}]);
});
