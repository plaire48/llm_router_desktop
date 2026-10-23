import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {createTabMirror} from '../browser-connector/mirror.js';
import {mirrorPoint} from '../electron-app/browser-mirror-input.mjs';
const require=createRequire(import.meta.url),{ExternalBrowserMirror}=require('../electron-app/external-browser-mirror.cjs'),{createExternalBrowserContentPort}=require('../electron-app/external-browser-content-port.cjs');
const streamId='00000000-0000-4000-8000-000000000001',binding={streamId,tabId:'7',documentId:'document-1'};
function extension(){
 const commands=[],frames=[],record={documentId:binding.documentId};let closed=false;
 const chrome={debugger:{attach:async()=>{},sendCommand:async(target,method,params)=>{commands.push({target,method,params});return {};}}};
 const row=async(id,args)=>{if(closed)throw Error('browser_tab_missing');if(id!=7)throw Error('browser_tab_missing');if(args.documentId!==record.documentId)throw Error('browser_document_changed');return {tab:{id:7},record};};
 const mirror=createTabMirror({chrome,send:value=>frames.push(value),row,attached:new Set()});
 const frame=(sessionId=1)=>mirror.frame({tabId:7},'Page.screencastFrame',{sessionId,data:'AA==',metadata:{deviceWidth:1000,deviceHeight:800}});
 return {mirror,commands,frames,record,frame,close:()=>closed=true};
}
test('only the visible consumer acknowledgement releases a frame, without retaining a queue',async()=>{
 const f=extension();await f.mirror.dispatch('mirrorStart',binding);f.frame();f.frame(2);assert.equal(f.frames.length,1);assert.equal(f.commands.filter(x=>x.method==='Page.screencastFrameAck').length,1);
 assert.deepEqual(await f.mirror.dispatch('mirrorAck',{...binding,sequence:99}),{acknowledged:false});
 assert.deepEqual(await f.mirror.dispatch('mirrorAck',{...binding,sequence:1}),{acknowledged:true});f.frame(3);assert.equal(f.frames.length,2);await f.mirror.dispatch('mirrorStop',binding);
});
test('a stale input or obsolete stream stop cannot touch a replacement stream',async()=>{
 const f=extension();await f.mirror.dispatch('mirrorStart',binding);f.frame();const replacement={...binding,streamId:'00000000-0000-4000-8000-000000000002'};await f.mirror.dispatch('mirrorStart',replacement);f.frame();
 await assert.rejects(()=>f.mirror.dispatch('mirrorInput',{...binding,input:{kind:'text',text:'old'}}),/mirror_changed/);
 assert.deepEqual(await f.mirror.dispatch('mirrorStop',binding),{stopped:false});assert.equal(f.mirror.active(7),true);assert.equal(f.commands.some(x=>x.method==='Input.insertText'),false);await f.mirror.dispatch('mirrorStop',replacement);
});
test('navigation invalidates inputs and stops streaming without closing the real tab',async()=>{
 const f=extension();await f.mirror.dispatch('mirrorStart',binding);f.frame();f.record.documentId='document-2';f.mirror.invalidate(7);
 await assert.rejects(()=>f.mirror.dispatch('mirrorInput',{...binding,input:{kind:'text',text:'old'}}),/mirror_changed/);assert.equal(f.mirror.active(7),false);assert.equal(f.commands.some(x=>/close/i.test(x.method)),false);
});
test('direct text and wheel inputs are sent once, use viewport coordinates, and protect manual work',async()=>{
 const f=extension();await f.mirror.dispatch('mirrorStart',binding);f.frame();
 await f.mirror.dispatch('mirrorInput',{...binding,input:{kind:'text',text:'한글 abc'}});await f.mirror.dispatch('mirrorInput',{...binding,input:{kind:'wheel',x:10,y:20,deltaX:0,deltaY:120}});
 assert.equal(f.commands.filter(x=>x.method==='Input.insertText').length,1);assert.equal(f.mirror.interacting(7),true);
 await assert.rejects(()=>f.mirror.dispatch('mirrorInput',{...binding,input:{kind:'mouse',type:'mousePressed',button:'left',x:1001,y:1}}),/mirror_bounds/);await f.mirror.dispatch('mirrorStop',binding);
});
test('stopping or hiding a stream releases held keys and mouse buttons',async()=>{
 const f=extension();await f.mirror.dispatch('mirrorStart',binding);f.frame();await f.mirror.dispatch('mirrorInput',{...binding,input:{kind:'key',type:'rawKeyDown',key:'Shift',code:'ShiftLeft',keyCode:16}});await f.mirror.dispatch('mirrorInput',{...binding,input:{kind:'mouse',type:'mousePressed',button:'left',x:10,y:20}});await f.mirror.dispatch('mirrorStop',binding);
 assert(f.commands.some(x=>x.method==='Input.dispatchKeyEvent'&&x.params.type==='keyUp'));assert(f.commands.some(x=>x.method==='Input.dispatchMouseEvent'&&x.params.type==='mouseReleased'));
});
test('sidebar viewport changes apply to the owned tab and are restored when streaming stops',async()=>{
 const f=extension();await f.mirror.dispatch('mirrorStart',{...binding,width:440,height:800});assert(f.commands.some(x=>x.method==='Emulation.setDeviceMetricsOverride'&&x.params.width===440&&x.params.height===800));await f.mirror.dispatch('mirrorStop',binding);assert(f.commands.some(x=>x.method==='Emulation.clearDeviceMetricsOverride'));
 await assert.rejects(()=>f.mirror.dispatch('mirrorStart',{...binding,width:9000,height:800}),/mirror_bounds/);assert.equal(f.mirror.active(7),false);
});
test('pointer coordinates retain source CSS pixels under sidebar scaling and reject margins',()=>{
 assert.deepEqual(mirrorPoint({left:50,top:20,width:500,height:400},{width:1000,height:800},300,220),{x:500,y:400});assert.equal(mirrorPoint({left:50,top:20,width:500,height:400},{width:1000,height:800},49,220),null);
});
function hostFixture(){
 const commands=[],events=[],row={id:'7',url:'https://example.test/work',automationDocument:'document-1'},host={generation:'generation-1',tabs:new Map(),tab:()=>row,command:async(action,args)=>{commands.push({action,args});return {};}};host.tabs.set('7',row);host.mirror=new ExternalBrowserMirror(host,{onEvent:event=>events.push(event)});return {host,row,events,commands,mirror:host.mirror};
}
test('renderer frames have a private binding and never appear in ordinary state or automation events',async()=>{
 const f=hostFixture();await f.mirror.start(binding);f.mirror.frame({...binding,sequence:1,data:'AA==',viewport:{width:1000,height:800}});assert.equal(f.events.length,1);assert.equal(f.events[0].type,'frame');f.mirror.frame({...binding,streamId:'old',sequence:2,data:'AA==',viewport:{width:1000,height:800}});assert.equal(f.events.length,1);assert.equal(f.row.data,undefined);
});
test('document and connection generations are revalidated before human input is issued',async()=>{
 const f=hostFixture();await f.mirror.start(binding);f.mirror.frame({...binding,sequence:1,data:'AA==',viewport:{width:1000,height:800}});f.host.generation='generation-2';await assert.rejects(()=>f.mirror.input({...binding,input:{kind:'text',text:'wrong'}}),/mirror_changed/);assert.equal(f.commands.some(x=>x.action==='mirrorInput'),false);
});
test('human authentication frames block app captures until the viewer confirms that it cleared them',async()=>{
 const f=hostFixture(),window=new EventEmitter();window.isDestroyed=()=>false;window.webContents={isDestroyed:()=>false,send(){}};const port=createExternalBrowserContentPort({browser:f.host,router:{mode:'external'},window,Menu:{},clipboard:{}});
 f.row.authentication=true;await f.mirror.start(binding);f.mirror.frame({...binding,sequence:1,data:'AA==',viewport:{width:1000,height:800}});await assert.rejects(()=>port.capture(async()=>({image:'must not escape'})),/auth_protected/);
 f.mirror.invalidate();await assert.rejects(()=>port.capture(async()=>({image:'stale frame'})),/auth_protected/);await port.request({action:'stop',...binding});assert.deepEqual(await port.capture(async()=>({image:'safe'})),{image:'safe'});port.dispose();
});
test('an authentication frame appearing during capture rejects the resulting app image',async()=>{
 const f=hostFixture(),window=new EventEmitter();window.isDestroyed=()=>false;window.webContents={isDestroyed:()=>false,send(){}};const port=createExternalBrowserContentPort({browser:f.host,router:{mode:'external'},window,Menu:{},clipboard:{}});await f.mirror.start(binding);
 await assert.rejects(()=>port.capture(async()=>{f.row.authentication=true;f.mirror.frame({...binding,sequence:1,data:'AA==',viewport:{width:1000,height:800}});return {image:'late sensitive frame'};}),/auth_protected/);port.dispose();
});
