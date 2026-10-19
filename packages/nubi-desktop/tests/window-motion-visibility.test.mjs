import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {watchMotionVisibility} from '../electron-app/motion-visibility.cjs';
test('native hide/minimize and show/restore publish one boolean and replay after renderer load',async()=>{
 const win=new EventEmitter(),contents=new EventEmitter(),sent=[];let visible=true,minimized=false;
 Object.assign(contents,{isDestroyed:()=>false,send:(...args)=>sent.push(args)});Object.assign(win,{webContents:contents,isDestroyed:()=>false,isVisible:()=>visible,isMinimized:()=>minimized});
 const stop=watchMotionVisibility(win);assert.deepEqual(sent.at(-1),['nubi:host-event',{type:'window_visibility',visible:true}]);
 visible=false;win.emit('hide');win.emit('hide');await new Promise(setImmediate);assert.equal(sent.length,2);assert.equal(sent.at(-1)[1].visible,false);
 visible=true;win.emit('show');assert.equal(sent.length,3);minimized=true;win.emit('minimize');assert.equal(sent.length,4);assert.equal(sent.at(-1)[1].visible,false);minimized=false;win.emit('restore');assert.equal(sent.at(-1)[1].visible,true);
 contents.emit('did-finish-load');assert.equal(sent.length,6);stop();stop();win.emit('hide');assert.equal(sent.length,6);assert.equal(contents.listenerCount('did-finish-load'),0);
});
test('bounded main-process fallback catches missing native events and stops on dispose',()=>{
 const win=new EventEmitter(),contents=new EventEmitter(),sent=[];let visible=true,poll,cancelled=0;
 Object.assign(contents,{isDestroyed:()=>false,send:(_,event)=>sent.push(event)});Object.assign(win,{webContents:contents,isDestroyed:()=>false,isVisible:()=>visible,isMinimized:()=>false});
 const stop=watchMotionVisibility(win,{schedule:(callback,interval)=>{assert.equal(interval,250);poll=callback;return {unref(){}};},cancel:()=>cancelled++});
 assert.equal(typeof poll,'function');visible=false;poll();assert.equal(sent.at(-1).visible,false);visible=true;poll();assert.equal(sent.at(-1).visible,true);stop();assert.equal(cancelled,1);
});
test('native visibility callbacks never query AppKit window state reentrantly',async()=>{
 const win=new EventEmitter(),contents=new EventEmitter();let callback=false,reads=0;
 Object.assign(contents,{isDestroyed:()=>false,send:()=>{}});Object.assign(win,{webContents:contents,isDestroyed:()=>false,isVisible:()=>{assert.equal(callback,false);reads++;return true;},isMinimized:()=>false});
 const stop=watchMotionVisibility(win);const before=reads;callback=true;win.emit('hide');callback=false;assert.equal(reads,before);await new Promise(setImmediate);stop();
});
test('native closed cleanup tolerates BrowserWindow releasing its WebContents first',()=>{
 const win=new EventEmitter(),contents=new EventEmitter();let destroyed=false,cancelled=0;
 Object.assign(contents,{isDestroyed:()=>destroyed,send:()=>{}});Object.assign(win,{isDestroyed:()=>destroyed,isVisible:()=>true,isMinimized:()=>false});
 Object.defineProperty(win,'webContents',{get:()=>destroyed?null:contents});
 watchMotionVisibility(win,{schedule:()=>({unref(){}}),cancel:()=>cancelled++});
 destroyed=true;assert.doesNotThrow(()=>win.emit('closed'));assert.equal(cancelled,1);assert.equal(contents.listenerCount('did-finish-load'),0);
});
