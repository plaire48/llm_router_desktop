import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {ProjectService} from '../runtime/project-service.mjs';
import {createNativeWikiQuestionSearch} from '../runtime/wiki-search-index.mjs';
import {delegateWikiQuestion} from '../../../extensions/aipro-chat/openwiki-agent.js';

test('large Wiki text is searchable beyond the former one-MiB source cutoff',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-large-wiki-')),storageRoot=await mkdtemp(path.join(os.tmpdir(),'nubi-large-state-'));
 const service=new ProjectService({storageRoot});t.after(async()=>{service.dispose();service.store.close();await rm(root,{recursive:true,force:true});await rm(storageRoot,{recursive:true,force:true});});
 await mkdir(path.join(root,'openwiki'));
 await writeFile(path.join(root,'openwiki/policy.md'),'# 규모 시험\n\n'+('일반 배경 설명입니다.\n'.repeat(48000))+'\n## 상세 계약\n\nZephyrNeedle의 승인 조건은 서명 검증입니다.\n');
 await service.open(root,{initializeWiki:false});
 const result=await service.wikiQuery({query:'ZephyrNeedle 승인 조건'});
 assert(result.results.some(row=>row.excerpt.includes('서명 검증')));
 await writeFile(path.join(root,'openwiki/policy.md'),'# 규모 시험\n\n## 상세 계약\n\nZephyrNeedle의 승인 조건은 원문 대조입니다.\n');
 const changed=await service.wikiQuery({query:'ZephyrNeedle 승인 조건'});
 assert(changed.results.some(row=>row.excerpt.includes('원문 대조')));
 assert(!changed.results.some(row=>row.excerpt.includes('서명 검증')));
});

test('project Wiki search uses native OpenWiki sections and invalidates changed and excluded pages',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-native-wiki-')),storageRoot=await mkdtemp(path.join(os.tmpdir(),'nubi-native-state-'));
 const service=new ProjectService({storageRoot});t.after(async()=>{service.dispose();service.store.close();await rm(root,{recursive:true,force:true});await rm(storageRoot,{recursive:true,force:true});});
 await mkdir(path.join(root,'openwiki'));await writeFile(path.join(root,'openwiki/a.md'),'# 달빛 실행\n\n## 절차\n\n사본 작성 뒤 승인합니다.\n');
 await service.open(root,{initializeWiki:false});
 const first=await service.wikiQuery({query:'달빛의 승인 절차'});assert.match(first.retrieval.method,/openwiki-section-fts5/);assert.equal(first.results[0].path,'openwiki/a.md');assert.match(first.results[0].excerpt,/사본 작성 뒤 승인/);
 const repeat=await service.wikiQuery({query:'달빛의 승인 절차'});assert.equal(repeat.retrieval.index.loaded,0);
 await writeFile(path.join(root,'openwiki/a.md'),'# 별빛 실행\n\n## 취소\n\nNATIVE_REPLACED_TOKEN을 확인합니다.\n');
 const changed=await service.wikiQuery({query:'NATIVE_REPLACED_TOKEN'});assert.equal(changed.results[0].path,'openwiki/a.md');assert.notEqual(changed.results[0].hash,first.results[0].hash);
 await writeFile(path.join(root,'.openwikiignore'),'openwiki/a.md\n');assert.equal((await service.wikiQuery({query:'NATIVE_REPLACED_TOKEN'})).results.length,0);
});

test('delegated code Wiki research uses native search and exact section reads with cleanup',async()=>{
 const text='# Limits\n\n## Renewal\n\nThe renewal quota is 17 seconds.\n',documents=[{id:'limits',path:'openwiki/limits.md',kind:'wiki',title:'Limits',text,version:'one'}],snapshot={wikiId:'external:project',sourceComplete:true,documents};let created=0,closed=0,searched=0;
 const createWikiSearch=async docs=>{created++;const native=await createNativeWikiQuestionSearch(docs),search=(...args)=>{searched++;return native(...args);};search.context=native.context;search.close=()=>{closed++;native.close();};return search;};
 const complete=async messages=>{
  const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
  const report=ids=>JSON.stringify({status:'complete',answer:'The renewal quota is 17 seconds.',findings:[{text:'The renewal quota is 17 seconds.',citations:ids}],uncertainties:[]});
  if(system.includes('Plan OpenWiki research'))return {content:JSON.stringify({mode:'focused',questions:['Renewal quota seconds']})};
  if(system.includes('Synthesize'))return {content:report(JSON.parse(messages.at(-1).content).evidence.slice(0,1).map(row=>row.id))};
  const observed=messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)),read=observed.find(row=>row.id);
  if(read)return {content:report([read.id])};
  const hit=observed.find(Array.isArray)?.[0],name=hit?'read_wiki':'search_wiki',args=hit?{documentId:hit.documentId,start:hit.start,length:hit.end-hit.start}:{query:'Renewal quota seconds'};
  return {content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]};
 };
 const result=await delegateWikiQuestion({wiki:'external',question:'What is the renewal quota?'},{execute:async()=>snapshot,complete,createWikiSearch,signal:new AbortController().signal,modelId:'synthetic-native'});
 assert.equal(result.status,'complete');assert.equal(created,1);assert.equal(closed,1);assert(searched>0);assert(result.evidence.some(row=>row.excerpt.includes('17 seconds')));assert(result.evidence.every(row=>text.slice(row.start,row.end)===row.excerpt));
});
