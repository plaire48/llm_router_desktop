import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {DemonstrationRecorder,DEMONSTRATION_BINDING}=require('../electron-app/demonstration-recorder.cjs');

// Browser teach plan T3, product step: the recorder works over the tab debugger interface both product browsers
// expose (the real webContents.debugger and the extension-relayed shim).
function fakeTab({attached=false,fail=null}={}){
 const dbg=new EventEmitter();dbg.calls=[];let flag=attached;
 Object.assign(dbg,{isAttached:()=>flag,attach:()=>{if(flag)throw Error('browser_debugger_busy');flag=true;},detach:()=>{flag=false;dbg.emit('detach');},
  sendCommand:async(method,params)=>{dbg.calls.push([method,params]);if(method===fail)throw Error('cdp_failed');
   if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'main'}}};
   if(method==='Page.addScriptToEvaluateOnNewDocument')return {identifier:'script-1'};
   if(method==='Runtime.enable'){dbg.emit('message',null,'Runtime.executionContextCreated',{context:{id:1,auxData:{isDefault:true,frameId:'main'}}});dbg.emit('message',null,'Runtime.executionContextCreated',{context:{id:2,auxData:{isDefault:true,frameId:'child'}}});}
   return {};}});
 const wc=new EventEmitter();let destroyed=false;Object.assign(wc,{debugger:dbg,isDestroyed:()=>destroyed,getURL:()=>'https://demo.invalid/form',getTitle:()=>'양식',destroy(){destroyed=true;wc.emit('destroyed');}});
 return {row:{id:'tab-1',automationDocument:'doc-1',view:{webContents:wc}},dbg,wc};
}
const payload=(extra={})=>JSON.stringify({kind:'click',at:1,index:0,items:[{tag:'button',name:'제출'}],url:'https://demo.invalid/form',title:'양식',...extra});
const called=(dbg,contextId,text,name=DEMONSTRATION_BINDING)=>dbg.emit('message',null,'Runtime.bindingCalled',{name,payload:text,executionContextId:contextId});

test('an owned recording injects the script, keeps main-frame events only and detaches on stop',async()=>{
 const {row,dbg}=fakeTab(),recorder=new DemonstrationRecorder({script:'/*demo*/'});
 const started=await recorder.start(row,{allowUrl:url=>!url.includes('login')});
 assert.equal(started.recording,true);assert.equal(started.shared,false);
 assert.deepEqual(dbg.calls.map(([method])=>method),['Page.enable','Page.getFrameTree','Runtime.enable','Page.addScriptToEvaluateOnNewDocument','Runtime.addBinding','Runtime.evaluate']);
 assert.equal(dbg.calls[3][1].source,'/*demo*/');assert.equal(dbg.calls[4][1].name,DEMONSTRATION_BINDING);
 called(dbg,1,payload());
 called(dbg,2,payload({index:0}));// a same-process child frame
 called(dbg,1,payload(),'__other');// another binding
 called(dbg,1,payload({url:'https://idp.invalid/login'}));// a page the host excludes
 called(dbg,1,'{not json');
 assert.equal(recorder.status('tab-1').events,1);assert.equal(recorder.status('tab-1').dropped,3);
 const stopped=recorder.stop('tab-1');
 assert.equal(stopped.events.length,1);assert.equal(stopped.events[0].items[0].name,'제출');assert.equal(stopped.reason,'stopped');
 assert.equal(dbg.isAttached(),false,'an owned attachment is released');
 assert.equal(recorder.status('tab-1').recording,false);
 assert.throws(()=>recorder.stop('tab-1'),/browser_recording_missing/);
});

test('a tab the Playwright port holds is shared: no attach, and only the binding and script are removed on stop',async()=>{
 const {row,dbg}=fakeTab({attached:true}),recorder=new DemonstrationRecorder({script:'/*demo*/'});
 const started=await recorder.start(row);assert.equal(started.shared,true);
 called(dbg,1,payload());
 recorder.stop('tab-1');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(dbg.isAttached(),true,'the other owner keeps its session');
 assert.deepEqual(dbg.calls.slice(-2).map(([method])=>method),['Runtime.removeBinding','Page.removeScriptToEvaluateOnNewDocument']);
 assert.equal(dbg.calls.at(-1)[1].identifier,'script-1');
});

test('a closed tab ends the recording but keeps the events for stop, and the limit ends it too',async()=>{
 const closing=fakeTab(),recorder=new DemonstrationRecorder({script:'/*demo*/'});
 await recorder.start(closing.row);called(closing.dbg,1,payload());closing.wc.destroy();
 assert.equal(recorder.status('tab-1').recording,false);assert.equal(recorder.status('tab-1').reason,'tab_closed');
 assert.equal(recorder.stop('tab-1').events.length,1);
 const limited=fakeTab(),second=new DemonstrationRecorder({script:'/*demo*/'});
 await second.start(limited.row,{limit:2});for(let i=0;i<3;i++)called(limited.dbg,1,payload());
 const result=second.stop('tab-1');assert.equal(result.events.length,2);assert.equal(result.reason,'limit');assert.equal(limited.dbg.isAttached(),false);
});

test('a failed injection releases an owned attachment and reports the recorder as unavailable',async()=>{
 const {row,dbg}=fakeTab({fail:'Runtime.addBinding'}),recorder=new DemonstrationRecorder({script:'/*demo*/'});
 await assert.rejects(recorder.start(row),/browser_recorder_unavailable/);
 assert.equal(dbg.isAttached(),false);assert.equal(dbg.listenerCount('message'),0);assert.equal(recorder.status('tab-1').recording,false);
});

test('without an override the recorder injects the browser module script itself',async()=>{
 const script=await new DemonstrationRecorder().script();
 assert.match(script,/__nubiDemonstration/);assert.match(script,/addEventListener\('click'/);
});
