import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const {BrowserLaunch}=createRequire(import.meta.url)('../electron-app/external-browser-launch.cjs');
const {BrowserRouter}=createRequire(import.meta.url)('../electron-app/browser-router.cjs');
test('integration preference survives toggling without deciding whether a window was imported',async t=>{
 const storage=await mkdtemp(path.join(os.tmpdir(),'nubi-browser-mode-'));t.after(()=>rm(storage,{recursive:true,force:true}));
 const fresh=new BrowserLaunch({storage});
 await fresh.mode('external');const restarted=new BrowserLaunch({storage});await restarted.load();assert.equal(restarted.status().mode,'external');
 await restarted.mode('internal');const off=new BrowserLaunch({storage});await off.load();assert.equal(off.status().mode,'internal');
 assert.equal(JSON.parse(await readFile(path.join(storage,'browser-preference.json'),'utf8')).mode,'internal');
});
test('external mode shows connection setup or paired content without silently opening an internal page',async()=>{
 for(const connected of [false,true]){const {router,calls}=ports();router.dock.status=()=>({phase:'idle',windowDocked:false});router.external.status=()=>({connected,tabs:[]});assert.equal(router.configuration().showInternal,false);await router.ui({action:'new'});assert.equal(calls.some(call=>call[0]==='internal'&&call[1].action==='new'),false);assert.equal(router.showInternal,false);}
});
function ports(){
 const calls=[],internal={tabs:new Map([['old-tab',{}]]),active:'old-tab',request:async args=>{calls.push(['internal',args]);return {tabs:[{id:'old-tab'}],active:'old-tab'};},publish:()=>calls.push(['publish'])};
 const launch={preference:{mode:'external'},status(){return {mode:this.preference.mode};},async mode(mode){calls.push(['mode',mode]);this.preference.mode=mode;}};
 const external={status:()=>({connected:true,tabs:[{id:'external-tab'}]}),stop:async()=>calls.push(['stop']),playwright:{dispose:()=>calls.push(['external-dispose'])}};
 const router=new BrowserRouter({internal,launch,external,notify:event=>calls.push(['notify',event])});router.internalPlaywright={dispose:()=>calls.push(['internal-dispose']),request:async()=>({tabId:'old-tab'})};
 router.dock={phase:'docked',status:()=>({phase:'docked',windowDocked:true,automationReady:false}),cancel:async()=>{calls.push(['restore']);return {cancelled:true};}};return {router,calls,internal,launch};
}
test('turning integration off restores the native window and retains existing internal tabs',async()=>{
 const {router,calls,internal}=ports();const result=await router.setMode('internal');assert.equal(result.mode,'internal');assert.equal(result.showInternal,true);assert(internal.tabs.has('old-tab'));
 assert(calls.findIndex(c=>c[0]==='restore')<calls.findIndex(c=>c[0]==='mode'));assert(calls.some(c=>c[0]==='stop'));assert(calls.some(c=>c[0]==='notify'));
});
test('unconfirmed native restoration cannot be hidden by reporting integration off',async()=>{
 const {router,launch}=ports();router.dock.cancel=async()=>({cancelled:false,restoreUnconfirmed:true});await assert.rejects(()=>router.setMode('internal'),/restore_unconfirmed/);assert.equal(launch.preference.mode,'external');
});
test('integration off rejects native bring without hiding the internal browser',async()=>{
 const {router,calls,launch}=ports();launch.preference.mode='internal';await assert.rejects(()=>router.playwright('bring',{}),/external_browser_disabled/);assert.deepEqual(calls,[]);
});
test('an observed internal tab is not blocked by a different docked external window',async()=>{
 const {router}=ports();assert.deepEqual(await router.playwright('check',{tabId:'old-tab'}),{tabId:'old-tab'});
});
test('toggling an idle integration does not hide the visible internal viewport',async()=>{
 const {router,calls}=ports();router.dock.status=()=>({phase:'idle',windowDocked:false});await router.setMode('internal');assert.equal(calls.some(call=>call[0]==='internal'&&call[1].action==='layout'&&call[1].visible===false),false);
});
test('a failed preference save does not report an unpersisted mode as selected',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-browser-save-'));t.after(()=>rm(directory,{recursive:true,force:true}));const storage=path.join(directory,'not-a-directory');await writeFile(storage,'fixture');const launch=new BrowserLaunch({storage});await assert.rejects(()=>launch.mode('internal'));assert.equal(launch.preference.mode,'external');
});
test('page capture uses the connected external document without requiring a native window import',async()=>{
 const {router,internal,calls}=ports();router.dock.status=()=>({phase:'idle',windowDocked:false});internal.capture=async()=>assert.fail('internal fallback');router.external.active='external-tab';router.external.tab=()=>({automationDocument:'external-document'});router.external.request=async(action,args)=>({action,args});
 assert.deepEqual(await router.capture({maxWidth:900}),{action:'capture',args:{maxWidth:900,tabId:'external-tab',documentId:'external-document'}});assert.deepEqual(calls,[]);
});
test('capture retains observed internal tab routing and imported external document binding',async()=>{
 const {router,internal}=ports();internal.capture=async id=>({image:id});router.external.active='external-tab';router.external.tab=()=>({automationDocument:'external-document'});router.external.request=async(action,args)=>({action,args});
 assert.deepEqual(await router.capture({tabId:'old-tab'}),{image:'old-tab'});
 assert.deepEqual(await router.capture({maxWidth:900}),{action:'capture',args:{maxWidth:900,tabId:'external-tab',documentId:'external-document'}});
});
test('MCP opening before connection preserves the existing browser without launching or assuming a permission screen',async()=>{
 const {router,calls,launch}=ports();router.external.status=()=>({connected:false,connectionPhase:'unavailable',connectionError:'browser_samsung_control_unavailable'});
 launch.open=async()=>{calls.push(['launch']);return {opened:true};};
 for(let i=0;i<2;i++){
  const result=await router.playwright('open',{url:'https://example.test/work'});
  assert.equal(result.opened,false);assert.equal(result.connectionRequired,true);assert.equal(result.error,'browser_samsung_control_unavailable');
  assert.doesNotMatch(result.instruction,/wait for the user to allow/i);
 }
 assert.equal(calls.some(c=>c[0]==='launch'||c[0]==='internal'),false);
 await assert.rejects(()=>router.playwright('open',{url:'file:///private'}),/browser_url_invalid/);
});
