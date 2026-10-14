import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {installationStamp,INSTALLATION_MARKER} from '../electron-app/installation-stamp.cjs';
import {openingSceneId,needsOpeningScene,rememberOpeningScene,OPENING_SCENE_KEY} from '../ui/opening-scene.mjs';
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
 for(const uuid of ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']){await writeFile(path.join(dir,INSTALLATION_MARKER),'{'+uuid.toUpperCase()+'}');assert.equal(await installationStamp(args),uuid);assert.equal(await installationStamp(args),uuid);}
 await writeFile(path.join(dir,INSTALLATION_MARKER),'invalid --flag');assert.equal(await installationStamp(args),old);
 assert.equal(await installationStamp({...args,packaged:false}),'');
});
