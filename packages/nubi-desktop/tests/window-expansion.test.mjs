import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const {WindowExpansion,expandedBounds}=createRequire(import.meta.url)('../electron-app/window-expansion.cjs');
function host(bounds={x:100,y:70,width:900,height:700},area={x:0,y:0,width:1600,height:1000}){
 let time=0,sequence=0;const timers=new Map(),calls=[],win=new EventEmitter(),screen=new EventEmitter();
 Object.assign(win,{getBounds:()=>({...bounds}),setBounds:value=>{bounds={...value};calls.push(value);},isDestroyed:()=>false,isMaximized:()=>false,isFullScreen:()=>false,isMinimized:()=>false});
 screen.getDisplayMatching=()=>({workArea:area});
 const controller=new WindowExpansion(win,screen,{now:()=>time,schedule:fn=>{timers.set(++sequence,fn);return sequence;},cancel:id=>timers.delete(id)});
 return {win,screen,controller,calls,move(value){bounds={...bounds,...value};win.emit('will-resize');},finish(){for(let i=0;i<30&&timers.size;i++){time+=16;const pending=[...timers.values()];timers.clear();for(const fn of pending)fn();}},timers};
}
test('opening expands within the current display and closing restores only owned bounds',()=>{
 const h=host(),before=h.win.getBounds();assert.equal(h.controller.layout({open:true,minimumWidth:1320}).changed,true);h.finish();assert.equal(h.win.getBounds().width,1320);assert(h.calls.length>1);h.controller.layout({open:false,minimumWidth:1320});h.finish();assert.deepEqual(h.win.getBounds(),before);h.controller.dispose();
});
test('negative display coordinates and right edge stay on the selected display',()=>{
 assert.deepEqual(expandedBounds({x:-800,y:10,width:700,height:650},{x:-1440,y:0,width:1440,height:900},1800),{x:-1440,y:10,width:1440,height:650});
});
test('a manually resized window never shrinks when the pane closes',()=>{
 const h=host();h.controller.layout({open:true,minimumWidth:1300});h.finish();h.move({width:1440});h.controller.layout({open:false,minimumWidth:1300});h.finish();assert.equal(h.win.getBounds().width,1440);h.controller.dispose();
});
test('manual movement cancels an expansion already in progress',()=>{
 const h=host();h.controller.layout({open:true,minimumWidth:1300});h.move({x:50,width:1100});h.finish();assert.deepEqual(h.win.getBounds(),{x:50,y:70,width:1100,height:700});assert.equal(h.timers.size,0);h.controller.dispose();
});
test('rapid close reverses from the latest actual bounds and leaves no timer',()=>{
 const h=host(),before=h.win.getBounds();h.controller.layout({open:true,minimumWidth:1300});h.controller.layout({open:false,minimumWidth:1300});h.finish();assert.deepEqual(h.win.getBounds(),before);assert.equal(h.timers.size,0);h.controller.dispose();
});
test('reopening before the first close frame cancels the old shrink',()=>{
 const h=host();h.controller.layout({open:true,minimumWidth:1300,reduced:true});h.controller.layout({open:false,minimumWidth:1300});h.controller.layout({open:true,minimumWidth:1300});h.finish();assert.equal(h.win.getBounds().width,1300);assert.equal(h.timers.size,0);h.controller.dispose();
});
test('reduced motion commits once and maximized windows retain their geometry',()=>{
 const h=host();h.controller.layout({open:true,minimumWidth:1300,reduced:true});assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);h.win.isMaximized=()=>true;assert.equal(h.controller.layout({open:false,minimumWidth:1300}).changed,false);assert.equal(h.win.getBounds().width,1300);h.controller.dispose();
});
test('a display change relinquishes restoration ownership',()=>{
 const h=host();h.controller.layout({open:true,minimumWidth:1300,reduced:true});h.screen.emit('display-metrics-changed');h.controller.layout({open:false,minimumWidth:1300});h.finish();assert.equal(h.win.getBounds().width,1300);h.controller.dispose();assert.equal(h.screen.listenerCount('display-metrics-changed'),0);
});
test('malformed layout requests and opening in an already wide window do not change bounds',()=>{
 const h=host();assert.throws(()=>h.controller.layout({open:true,minimumWidth:Infinity}),/invalid/);assert.throws(()=>h.controller.layout({open:'yes',minimumWidth:1300}),/invalid/);assert.equal(h.controller.layout({open:true,minimumWidth:800}).changed,false);h.controller.layout({open:false,minimumWidth:800});assert.equal(h.calls.length,0);h.controller.dispose();
});
