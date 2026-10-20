import {test} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import api from '../electron-app/wiki-lifecycle.cjs';
test('native Wiki lifecycle forwards power/network transitions with owner binding and stops cleanly',async()=>{
 assert.equal(typeof api.watchWikiLifecycle,'function');const powerMonitor=new EventEmitter(),events=[];let online=true,poll,cleared=false,root='/one';
 const stop=api.watchWikiLifecycle({powerMonitor,net:{isOnline:()=>online},invoke:async(method,args)=>events.push({method,...args}),owner:()=>root,schedule:callback=>{poll=callback;return {unref(){}};},cancel:()=>{cleared=true;}});
 powerMonitor.emit('suspend');powerMonitor.emit('suspend');powerMonitor.emit('resume');online=false;poll();poll();root='/two';poll();online=true;poll();
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(events.map(row=>[row.event,row.expectedRoot]),[['suspend','/one'],['resume','/one'],['offline','/one'],['offline','/two'],['online','/two']]);
 stop();powerMonitor.emit('suspend');poll();await new Promise(resolve=>setImmediate(resolve));assert.equal(events.length,5);assert(cleared);assert.equal(powerMonitor.listenerCount('suspend'),0);
});
