import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createOfficeView} from '../worker/office-view.mjs';
import {createActivityLog} from '../worker/activity.mjs';

const observation=()=>({id:'abcdef0123456789',observedAt:Date.now(),elements:[{id:'ui-1',name:'보고서',type:'Text',enabled:true,runtimeId:[1,2],bounds:[10,20,100,40]}],binding:{scopeId:'scope',fingerprint:'fp'},window:42,processId:100,width:1200,height:800,truncated:false,imageStatus:'unavailable',imageUnavailableReason:'view_capture_failed'});
function setup({changed=false}={}){
  const calls=[],messages=[];let observations=0;
  const view=createOfficeView({enabled:true,host:'word',getBinding:()=>({scopeId:'scope',expectedFingerprint:'fp'}),signal:new AbortController().signal,metrics:{},activity:createActivityLog(),approve:async()=>({approved:true}),providers:{status:()=>({provider:'aipro',model:'explicit-image-model',vision:true}),complete:async(input,tools)=>{messages.push(input);assert.deepEqual(tools,[]);return{content:JSON.stringify({status:'complete',checks:[{requirement:'제목',status:'met',evidence_ids:[1]}],next_step:''})};}},call:async name=>{
    calls.push(name);
    if(name==='view_observe')return changed&&++observations>1?{error:'view_source_changed'}:observation();
    if(name==='view_act')return{outcome:'dispatched',documentUnchanged:true,view:observation()};
    throw new Error('Unexpected RPC '+name);
  }});
  return{view,calls,messages};
}

test('a failed native capture retains UIA evidence even for an image-capable model',async()=>{
  const f=setup();const observed=await f.view.execute('inspect_office_view');
  assert.equal(observed.elements[0].name,'보고서');assert.equal(observed.imageStatus,'unavailable');
  const reviewed=await f.view.execute('review_office_view',{criterion:'제목 표시'});
  assert.equal(reviewed.status,'complete');assert.equal(reviewed.imageViewed,false);assert.equal(reviewed.renderingVerified,false);assert.equal(reviewed.advisory,true);
  assert.deepEqual(f.calls,['view_observe','view_observe']);assert.match(f.messages[0][0].content,/NO IMAGE WAS PROVIDED/);
  assert.ok(f.messages[0].every(message=>typeof message.content==='string'));
});

test('capture fallback cannot hide a changed native document during text review',async()=>{
  const f=setup({changed:true});await f.view.execute('inspect_office_view');
  assert.equal((await f.view.execute('review_office_view',{criterion:'제목'})).error,'view_source_changed');
  assert.equal(f.view.context().review,null);assert.equal(f.messages.length,1);
});

test('post-action text observations require fresh verification without replaying input',async()=>{
  const f=setup();await f.view.execute('inspect_office_view');
  const args={viewId:'abcdef0123456789',targetId:'ui-1',action:'click'};
  const result=await f.view.execute('act_office_view',args);
  assert.equal(result.outcome,'dispatched');assert.equal(result.applicationVerified,false);
  assert.equal((await f.view.execute('act_office_view',args)).error,'view_expired');
  await f.view.execute('inspect_office_view');assert.doesNotThrow(()=>f.view.assertSettled());
  assert.equal(f.calls.filter(name=>name==='view_act').length,1);
});

test('native capture failure isolation keeps identity validation and returns no stale pixels (source contract)',async()=>{
  const source=await readFile(new URL('../native/Nubi.Office.View/Program.cs',import.meta.url),'utf8');
  const captureStart=source.indexOf('try {stage="capture";'),captureEnd=source.indexOf('stage="validate";',captureStart);
  assert.ok(captureStart>source.indexOf('stage="semantic_action";'));assert.ok(captureEnd>captureStart);
  const isolated=source.slice(captureStart,captureEnd);
  assert.match(isolated,/catch\(Exception error\) when \(error is ExternalException\|\|error is ArgumentException\|\|\(error is InvalidOperationException&&error.Message=="view_capture_failed"\)\)/);
  assert.match(isolated,/image=null;imageHash=null;imageWidth=0;imageHeight=0;imageStatus="unavailable";/);
  assert.doesNotMatch(isolated,/Console\.WriteLine|return;|CopyFromScreen|BitBlt/);
  assert.match(source.slice(captureEnd),/actual!=expected\|\|GetAncestor\(GetForegroundWindow\(\),2\)!=window.*throw new InvalidOperationException\("view_window_changed"\)/);
  assert.match(source.slice(captureEnd),/\["elements"\]=elements.*\["imageUnavailableReason"\]=imageUnavailableReason/);
});
