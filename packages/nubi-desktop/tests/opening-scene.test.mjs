import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {installationStamp,INSTALLATION_MARKER,markerId} from '../electron-app/installation-stamp.cjs';
import {openingSceneId,needsOpeningScene,rememberOpeningScene,OPENING_SCENE_KEY,openingSceneMode} from '../ui/opening-scene.mjs';
test('same-version reinstall replays; ordinary relaunch stays brief and incomplete scenes remain pending',()=>{
 const data=new Map([[OPENING_SCENE_KEY,'1.2.6']]),storage={getItem:key=>data.get(key),setItem:(key,v)=>data.set(key,v)};
 const first=openingSceneId('1.2.6','install-a'),reinstall=openingSceneId('1.2.6','install-b');
 assert(needsOpeningScene(storage,first));assert(needsOpeningScene(storage,first));
 rememberOpeningScene(storage,first);assert(!needsOpeningScene(storage,first));assert(needsOpeningScene(storage,reinstall));
 rememberOpeningScene(storage,reinstall);assert(!needsOpeningScene(storage,reinstall));assert(needsOpeningScene(storage,openingSceneId('1.2.7','install-c')));
});
test('unavailable local storage never suppresses the opening',()=>{
 const storage={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
 assert(needsOpeningScene(storage,'x'));assert.doesNotThrow(()=>rememberOpeningScene(storage,'x'));
});
test('installed marker rotates independently of user profile and supports deferred first launch',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-install-stamp-'));t.after(()=>rm(dir,{recursive:true,force:true}));const executable=path.join(dir,'nubi.exe');await writeFile(executable,'fixture');
 const args={packaged:true,platform:'win32',executable};const old=await installationStamp(args);assert.match(old,/^[a-f0-9]{64}$/);
 let previous=old;
 for(const uuid of ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']){await writeFile(path.join(dir,INSTALLATION_MARKER),'{'+uuid.toUpperCase()+'}');const stamp=await installationStamp(args);assert.match(stamp,/^[a-f0-9]{64}$/);assert.notEqual(stamp,previous);assert.equal(await installationStamp(args),stamp);previous=stamp;}
 await writeFile(executable,'replacement payload');assert.notEqual(await installationStamp(args),previous,'replacing payload replays even with a retained old marker');
 await writeFile(executable,'fixture');
 await writeFile(path.join(dir,INSTALLATION_MARKER),'invalid --flag');assert.match(await installationStamp(args),/^[a-f0-9]{64}$/);
 assert.equal(await installationStamp({...args,packaged:false}),'');
});

test('Windows marker decoding tolerates Unicode installer output without accepting arguments',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 for(const bytes of [Buffer.from(id),Buffer.from('\uFEFF{'+id+'}\r\n'),Buffer.from('\uFEFF{'+id+'}\r\n','utf16le')])assert.equal(markerId(bytes),id);
 assert.equal(markerId(Buffer.from(id+' --unsafe')),'');
});
test('installed scenes are not silently suppressed by a webdriver flag',()=>{
 const storage={getItem:()=>null},base={played:false,automated:true,installationId:'installed',storage,id:'new'};
 assert.equal(openingSceneMode(base),'full');assert.equal(openingSceneMode({...base,installationId:''}),'none');
 assert.equal(openingSceneMode({...base,reducedMotion:true}),'brief');
 assert.equal(openingSceneMode({...base,storage:{getItem:()=>base.id}}),'brief');
});

test('the sandboxed preload passes the installer stamp to the renderer intact',async()=>{
 const stamp='a'.repeat(64);let exposed;
 vm.runInNewContext(await readFile(new URL('../electron-app/preload.cjs',import.meta.url),'utf8'),{
  require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'nubi');exposed=value;}},ipcRenderer:new EventEmitter()};},
  process:{argv:['exe','--nubi-installation='+stamp],platform:'win32'}
 });
 assert.equal(exposed.installationId,stamp);assert.equal(exposed.desktop,true);
});

test('preload replays only the latest typed window visibility and disposes host subscribers',async()=>{
 const ipc=new EventEmitter();let api;
 vm.runInNewContext(await readFile(new URL('../electron-app/preload.cjs',import.meta.url),'utf8'),{
  require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{api=value;}},ipcRenderer:ipc}),process:{argv:['exe'],platform:'darwin'}
 });
 ipc.emit('nubi:host-event',{}, {type:'window_visibility',visible:false,unrelated:'must not be cached'});
 ipc.emit('nubi:host-event',{}, {type:'window_visibility',visible:'invalid'});
 const events=[],off=api.onHostEvent(event=>events.push(event));
 assert.equal(JSON.stringify(events),JSON.stringify([{type:'window_visibility',visible:false}]));
 ipc.emit('nubi:host-event',{}, {type:'window_visibility',visible:true});assert.equal(events.length,2);assert.equal(events[1].visible,true);
 off();assert.equal(ipc.listenerCount('nubi:host-event'),1,'only preload cache remains');
 ipc.emit('nubi:host-event',{}, {type:'window_visibility',visible:false});assert.equal(events.length,2);
 assert.throws(()=>api.onHostEvent(null),/callback_invalid/);
});
