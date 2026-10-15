import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {notifyWikiCompleted} from '../runtime/wiki-notification.mjs';
import {createWikiNotices} from '../electron-app/wiki-notices.cjs';
import {openWikiNotice} from '../ui/open-wiki-notice.mjs';

test('only saved completion states notify, without document content or paths',async()=>{
 const sent=[],service={root:'/private/project',projectId:'p',notifyWiki:value=>sent.push(value)};
 for(const state of ['running','failed','attention','cancelled','existing','proposed'])notifyWikiCompleted(service,{id:'j',state});
 assert.equal(sent.length,0);
 for(const state of ['completed','ready','applied'])notifyWikiCompleted(service,{id:'j',state,pages:3,changes:[{path:'secret.md'}],content:'PRIVATE'});
 assert.deepEqual(sent.map(x=>x.phase),['created','ready','applied']);assert.equal(sent[0].pages,3);assert.equal(sent[1].files,1);
 assert(!JSON.stringify(sent).includes('/private'));assert(!JSON.stringify(sent).includes('secret'));assert(!JSON.stringify(sent).includes('PRIVATE'));
 service.notifyWiki=()=>{throw Error('native_failed');};assert.doesNotThrow(()=>notifyWikiCompleted(service,{id:'j',state:'completed'}));
 service.notifyWiki=()=>Promise.reject(Error('ipc_failed'));notifyWikiCompleted(service,{id:'j',state:'ready'});await new Promise(resolve=>setImmediate(resolve));
});

test('Windows notifications distinguish preparation and publication, deduplicate and navigate only on click',()=>{
 const created=[],events=[],calls=[];
 class Notice extends EventEmitter{static isSupported(){return true;}constructor(options){super();this.options=options;created.push(this);}show(){}close(){}}
 const window={isDestroyed:()=>false,isMinimized:()=>true,restore:()=>calls.push('restore'),show:()=>calls.push('show'),focus:()=>calls.push('focus')};
 const options={Notification:Notice,getWindow:()=>window,send:e=>events.push(e),platform:'win32'};
 const notices=createWikiNotices(options),base={projectId:'p',jobId:'j',projectName:'개발 프로젝트',pages:3,files:2};
 for(const phase of ['created','ready','applied']){
  assert.equal(notices.show({...base,phase}).shown,true);assert.equal(notices.show({...base,phase}).shown,false);
 }
 assert.match(created[0].options.title,/위키 생성 완료/);assert.match(created[0].options.body,/3개 문서/);
 assert.match(created[1].options.title,/갱신안 준비 완료/);assert.match(created[1].options.body,/반영해 주세요/);
 assert.match(created[2].options.title,/반영 완료/);assert.equal(events.length,0);
 created[1].emit('click');created[1].emit('click');assert.deepEqual(events,[{type:'wiki_open',projectId:'p',jobId:'j',phase:'ready'}]);assert.deepEqual(calls,['restore','show','focus']);
 notices.clear();created[2].emit('click');assert.equal(events.length,1);
 assert.equal(createWikiNotices({...options,platform:'darwin'}).show({...base,phase:'created'}).shown,false);
 assert.equal(notices.show({...base,projectId:'../else',phase:'created'}).shown,false);
});

test('click uses normal project guards and never applies an update',async()=>{
 let project='other';const shown=[],event={type:'wiki_open',projectId:'p',jobId:'j',phase:'created'};
 const ports={currentProjectId:()=>project,switchProject:async id=>{project=id;},present:value=>shown.push(value)};
 assert.equal(await openWikiNotice(event,ports),true);assert.equal(shown[0].target,'wiki');
 await openWikiNotice({...event,phase:'ready'},ports);assert.equal(shown[1].target,'wiki-update');
 project='other';await assert.rejects(openWikiNotice(event,{...ports,switchProject:async()=>{throw Error('editor_dirty');}}),/editor_dirty/);
 assert.equal(await openWikiNotice(event,{...ports,switchProject:async()=>{}}),false);assert.equal(shown.length,2);
});
