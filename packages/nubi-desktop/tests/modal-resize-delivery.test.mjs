import test from 'node:test';
import assert from 'node:assert/strict';
import {installModalResizeMotion} from '../ui/modalResizeMotion.js';

test('resize delivery installs both visual tracks before the new bounds can paint',t=>{
 const originals=new Map(),set=(name,value)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});};
 let stop;t.after(()=>{stop?.();for(const [name,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
 let deliver,height=160,queued=0;const animations=[],classes=new Set();
 const animation=()=>{const value={cancel(){},finished:new Promise(()=>{})};animations.push(value);return value;};
 const surface={style:{},setAttribute(){},animate:animation,remove(){}};
 const backdrop={matches:()=>true,querySelector:()=>panel,append(){}};
 const panel={isConnected:true,parentElement:backdrop,offsetWidth:400,get offsetHeight(){return height;},getBoundingClientRect:()=>({left:100,top:100,width:400,height}),dataset:{},classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)},animate:animation};
 set('ResizeObserver',class{constructor(callback){deliver=callback;}observe(){}unobserve(){}disconnect(){}});
 set('MutationObserver',class{observe(){}disconnect(){}});
 set('DOMMatrixReadOnly',class{m41=0;m42=0;});set('innerWidth',1200);set('innerHeight',900);
 set('requestAnimationFrame',()=>{queued++;return queued;});set('cancelAnimationFrame',()=>{});
 set('matchMedia',()=>({addEventListener(){},removeEventListener(){}}));
 set('document',{body:{},querySelectorAll:()=>[backdrop],createElement:()=>surface,addEventListener(){},removeEventListener(){}});
 set('getComputedStyle',()=>({transform:'none',background:'white',borderRadius:'24px',boxShadow:'none',getPropertyValue:key=>key==='--nubi-modal-resize'?'280ms':'ease-out'}));
 stop=installModalResizeMotion(()=>true);
 deliver([{target:panel}]);height=240;deliver([{target:panel}]);
 assert.equal(animations.length,2,'surface and live text must already have their inverse transforms');
 assert.equal(queued,0,'a next-frame delay would briefly paint the final bounds before jumping back');
 assert.deepEqual(animations.map(value=>value.id),['nubi-modal-surface','nubi-modal-content']);
 assert.equal(classes.has('nubi-modal-morphing'),true);
});
