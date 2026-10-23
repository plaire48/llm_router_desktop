import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {AppScreenCapture,readAppScreen} from '../runtime/app-screen-capture.mjs';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {readCapture} from '../runtime/captures.mjs';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
installAgent(ProjectService);
const png=new PNG({width:80,height:60});png.data.fill(255);png.data[0]=0;
const image=PNG.sync.write(png).toString('base64');
const window={hwnd:123,processId:44,started:'123456789',title:'검토 앱 오류',processName:'FixtureApp',bounds:{x:-100,y:120,width:800,height:600}};
const element={runtimeId:'42,-123,9',name:'오류 내용',type:'Document',automationId:'error-body',bounds:{x:-80,y:200,width:200,height:100},password:false};
const native=async request=>request.action==='discover'?{windows:[window],partial:false}:request.action==='inspect'?{window,elements:[element],partial:false}:{window,element:request.element,image,width:80,height:60,passwordsMasked:true};
const make=options=>new AppScreenCapture({platform:'win32',read:native,...options});

test('UIA discovery issues IDs without capturing; a crop uses only an observed target and returns the exact bounded PNG',async()=>{
 const calls=[],capture=make({read:async request=>{calls.push(request);return native(request);}});
 const result=await capture.find({windowQuery:'검토 앱',controlQuery:'오류'});
 assert.deepEqual(calls.map(x=>x.action),['discover','inspect']);
 const found=result.windows[0];assert(!('hwnd' in found));assert(!('bounds' in found.elements[0]));
 const shot=await capture.capture({windowId:found.windowId,elementId:found.elements[0].elementId});
 assert.equal(shot.image,image);assert.deepEqual(shot.clip,element.bounds);assert.equal(shot.passwordsMasked,true);
 assert.deepEqual(calls.at(-1).element,element);assert.equal(calls.at(-1).action,'capture');
});

test('unknown, foreign-run, expired and cross-window IDs never reach native capture',async()=>{
 let time=0,captures=0;
 const capture=make({now:()=>time,read:async request=>{if(request.action==='capture')captures++;return native(request);}});
 const a=(await capture.find({windowQuery:'Fixture',controlQuery:'오류'})).windows[0];
 const b=(await capture.find({windowQuery:'Fixture'})).windows[0];
 await assert.rejects(capture.capture({windowId:'123'}),/app_capture_changed/);
 await assert.rejects(make().capture({windowId:a.windowId}),/app_capture_changed/);
 await assert.rejects(capture.capture({windowId:b.windowId,elementId:a.elements[0].elementId}),/app_capture_changed/);
 time=120001;await assert.rejects(capture.capture({windowId:a.windowId}),/app_capture_changed/);assert.equal(captures,0);
});

test('changed window/control and invalid image dimensions are not returned as a capture',async()=>{
 for(const change of [{window:{...window,processId:99}},{element:{...element,name:'다른 대상'}},{width:20000},{image:'AAAA'},{width:79}]){
  const capture=make({read:async request=>({...await native(request),...(request.action==='capture'?change:{})})});
  const found=(await capture.find({windowQuery:'Fixture',controlQuery:'오류'})).windows[0];
  await assert.rejects(capture.capture({windowId:found.windowId,elementId:found.elements[0].elementId}),/app_capture_(?:changed|contract)/);
 }
});

test('password UIA controls and malformed native metadata are rejected before IDs can be used',async()=>{
 const capture=make({read:async request=>({...await native(request),...(request.action==='inspect'?{elements:[{...element,password:true}]}:{})})});
 await assert.rejects(capture.find({windowQuery:'Fixture',controlQuery:'암호'}),/app_capture_contract/);
 await assert.rejects(make().find({windowQuery:''}),/app_capture_invalid/);
 await assert.rejects(make({platform:'darwin'}).find({windowQuery:'Fixture'}),/app_capture_windows/);
 await assert.rejects(readAppScreen({action:'discover',query:'Fixture'},{platform:'darwin'}),/app_capture_windows/);
});

test('native discovery cannot bypass the existing Nubi/browser authentication capture guard',async()=>{
 const capture=make({read:async()=>({windows:[{...window,processId:process.ppid},{...window,processId:process.pid}]})});
 assert.deepEqual((await capture.find({windowQuery:'Nubi'})).windows,[]);
});

test('late discovery/capture responses after cancellation are discarded',async()=>{
 for(const action of ['discover','capture']){
  const controller=new AbortController();
  const capture=make({read:async request=>{const result=await native(request);if(request.action===action)controller.abort(Error('cancelled'));return result;}});
  if(action==='discover')await assert.rejects(capture.find({windowQuery:'Fixture'},controller.signal),/cancelled/);
  else {const found=(await capture.find({windowQuery:'Fixture'})).windows[0];await assert.rejects(capture.capture({windowId:found.windowId},controller.signal),/cancelled/);}
 }
});

const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
test('agent captures a UIA region with Computer Use off, analyzes it and keeps that PNG on the answer and activity',async t=>{
 const {service}=await fixture(t);service.createAppScreenCapture=()=>make();
 let turn=0,modelImages=0,definitionsSeen=[],captureResult;
 service.providers={status:()=>({connected:true,provider:'chatgpt',model:'fixture',models:[{id:'fixture',supportsImages:true,contextLength:32000,maxOutputTokens:4096}]}),dispose(){},async complete(messages,definitions){
  if(messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url'))){modelImages++;assert(messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.image_url?.url==='data:image/png;base64,'+image)));return {content:'오류 영역의 안내를 확인했습니다.',calls:[]};}
  definitionsSeen=definitions;
  if(turn++===0)return call('find_app_capture_targets',{windowQuery:'검토 앱',controlQuery:'오류'});
  const last=JSON.parse(messages.filter(m=>m.role==='tool').at(-1).content);
  if(turn===2){const found=last.windows[0];return call('inspect_app_window',{windowId:found.windowId,elementId:found.elements[0].elementId,question:'오류 내용을 확인해 주세요'});}
  captureResult=last;return {content:'캡처한 오류 안내를 확인했습니다.',calls:[]};
 }};
 const task=await service.createTask({request:'검토 앱 오류 영역을 캡처해서 확인해 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
 assert.equal(DESKTOP_FEATURES.computerUse,false);assert(definitionsSeen.some(x=>x.function.name==='inspect_app_window'));assert(!definitionsSeen.some(x=>x.function.name==='propose_computer_action'));
 assert.equal(modelImages,1);assert.equal(captureResult.ok,true);assert.equal(captureResult.source,'windows-uia-printwindow');
 const saved=service.task(task.id),ref=saved.messages.at(-1).captures[0];
 assert.match(ref.label,/앱 화면 캡처: 검토 앱 오류/);assert.equal(ref.region,true);assert.equal(readCapture(service,ref.id).image,image);
 assert.equal(saved.trace.find(x=>x.tool==='inspect_app_window').captures[0].id,ref.id);
 assert.equal(saved.activityHistory.at(-1).trace.find(x=>x.tool==='inspect_app_window').captures[0].id,ref.id);
 assert(!JSON.stringify(saved).includes(image));
});

test('a failed native capture leaves no success image and keeps the manual Workspace capture tool available',async t=>{
 const {service}=await fixture(t);service.createAppScreenCapture=()=>make({read:async request=>{if(request.action==='capture')throw Error('app_capture_blank');return native(request);}});
 service.openWorkspacePage=async()=>({opened:true});service.captureWorkspaceWindow=async()=>({image,width:80,height:60});
 let turn=0,last;
 service.providers={status:()=>({connected:true,provider:'chatgpt',model:'fixture',models:[{id:'fixture',supportsImages:true,contextLength:32000,maxOutputTokens:4096}]}),dispose(){},async complete(messages,definitions){
  assert(definitions.some(x=>x.function.name==='inspect_workspace_window'));
  if(turn++===0)return call('find_app_capture_targets',{windowQuery:'Fixture'});
  last=JSON.parse(messages.filter(m=>m.role==='tool').at(-1).content);
  if(turn===2)return call('inspect_app_window',{windowId:last.windows[0].windowId,question:'화면을 확인해 주세요'});
  return {content:'직접 캡처한 화면을 첨부해 주세요.',calls:[]};
 }};
 const task=await service.createTask({request:'Fixture 화면을 캡처해 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
 assert.equal(last.ok,false);assert.equal(last.error,'app_capture_blank');assert.equal(service.task(task.id).messages.at(-1).captures?.length||0,0);
});
