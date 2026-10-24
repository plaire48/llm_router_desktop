import test from 'node:test';import assert from 'node:assert/strict';import {readFile,readdir,mkdir} from 'node:fs/promises';import path from 'node:path';
import {fixture} from './fixtures.mjs';

test('personal conversations reject every Wiki creation route before side effects',async t=>{
 const {service,root}=await fixture(t);service.workspaceKind='conversation';
 const task=await service.createTask({request:'개인 대화는 위키를 만들지 않습니다.'}),original=await readFile(path.join(root,'openwiki/home.md'),'utf8'),initial=service.store.get('wiki-init');let pulls=0;
 service.syncWikiSources=async()=>{pulls++;throw Error('must not pull');};
 for(const [method,args] of [
  ['wikiGeneration',{action:'set',value:{effort:'medium'}}],['wikiInitialization',{action:'retry'}],['wikiInitialization',{action:'scope',jobId:'old',folders:[]}],['wikiInitialization',{action:'reset',confirmed:true}],
  ...['propose','refresh','run','resume','apply'].map(method=>['wikiUpdate',{method,id:'old',fingerprint:'old'}]),['recordKnowledge',{taskId:task.id}],['exportKnowledgeMap',{taskId:task.id,expectedFingerprint:'old'}]
 ])await assert.rejects(async()=>service.invoke(method,args),/wiki_unavailable/,method+' '+JSON.stringify(args));
 await service.initializeWiki();assert.equal(pulls,0);assert.deepEqual(service.store.get('wiki-init'),initial);assert.equal(service.store.get('setting:wiki-generation'),null);assert.equal(service.recordingKnowledge||false,false);
 assert.equal(await readFile(path.join(root,'openwiki/home.md'),'utf8'),original);assert.deepEqual(await readdir(path.join(root,'openwiki')),['home.md']);
});

test('personal Wiki status is unavailable without exposing legacy project Wiki controls',async t=>{
 const {service}=await fixture(t);service.workspaceKind='conversation';
 assert.equal((await service.invoke('wikiGeneration')).available,false);assert.equal((await service.invoke('wikiUpdate')).available,false);assert.equal(service.wikiInitialization(),null);assert.deepEqual((await service.overview()).wikiFiles,[]);
});

test('the reserved personal folder remains personal even with a legacy project label',async t=>{
 const {service}=await fixture(t),root=path.join(service.storageRoot,'conversations');await mkdir(root,{recursive:true});
 const opened=await service.open(root,{kind:'project',initializeWiki:false});assert.equal(opened.kind,'conversation');
 await assert.rejects(async()=>service.wikiUpdate({method:'refresh'}),/wiki_unavailable/);assert.equal((await service.overview()).wikiInitialization,null);
});
