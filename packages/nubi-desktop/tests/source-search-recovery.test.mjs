import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir,symlink} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {searchSource} from '../runtime/source-search.mjs';
import {git,hash} from '../runtime/files.mjs';
const noSearch={resolveSearch:async()=>{throw Error('native missing');}};
test('missing or blocked native search falls back to bounded current project text with real hashes',async t=>{
 const {service,root}=await fixture(t);await mkdir(path.join(root,'src'));await writeFile(path.join(root,'src','a.txt'),'KEYWORD first\nkeyword second\n');await writeFile(path.join(root,'src','b.txt'),'Keyword last\n');await git(root,['add','-A']);
 const expected=await service.search({query:'keyword',within:'src'});
 for(const deps of [noSearch,{resolveSearch:async()=>'/fixture/native',executeSearch:async()=>{throw Object.assign(Error('private path'),{code:'EACCES'});}}]){
  const found=await searchSource.call(service,{query:'keyword',within:'src'},deps);assert.deepEqual(found.results,expected.results);assert.deepEqual(found.files,expected.files);assert.equal(found.engine,'filesystem');assert.equal(found.truncated,false);assert.match(found.fallback.reason,/search_unavailable|search_execution_denied/);assert(!JSON.stringify(found).includes('private path'));assert.equal(found.results[0].hash,hash('KEYWORD first\nkeyword second\n'));
 }
});
test('fallback does not read private, large, binary or outside files; omitted scope stays explicit',async t=>{
 const {service,root}=await fixture(t);await writeFile(path.join(root,'.env'),'KEYWORD secret');await writeFile(path.join(root,'large.txt'),'KEYWORD'+'.'.repeat(1024*1024));await writeFile(path.join(root,'binary.txt'),Buffer.from('KEYWORD\0SECRET'));await writeFile(path.join(path.dirname(root),'outside.txt'),'KEYWORD outside');await symlink(path.join(path.dirname(root),'outside.txt'),path.join(root,'linked.txt'));await git(root,['add','-A']);
 const found=await searchSource.call(service,{query:'KEYWORD'},noSearch);assert.equal(found.results.length,0);assert.equal(found.truncated,true);assert(found.skipped>=3);assert(!JSON.stringify(found).includes('secret'));
 await assert.rejects(searchSource.call(service,{query:'KEYWORD',within:'../outside.txt'},noSearch),/path_scope/);await assert.rejects(searchSource.call(service,{query:'KEYWORD\0'},noSearch),/input_invalid/);
});
test('zero matches, missing matches and cancellation are never confused with execution failure',async t=>{
 const {service}=await fixture(t);const found=await searchSource.call(service,{query:'does-not-exist'},noSearch);assert.equal(found.results.length,0);assert.equal(found.truncated,false);
 const native=await searchSource.call(service,{query:'does-not-exist'},{resolveSearch:async()=>'/fixture/native',executeSearch:async()=>{throw Object.assign(Error('none'),{code:1});}});assert.equal(native.results.length,0);assert.equal(native.engine,'ripgrep');assert.equal(native.truncated,false);
 const controller=new AbortController();controller.abort();await assert.rejects(searchSource.call(service,{query:'first',signal:controller.signal},noSearch),/cancelled/);
});
test('current-folder and Windows relative notation normalize without widening the project scope',async t=>{
 const {service,root}=await fixture(t);await mkdir(path.join(root,'src'));await writeFile(path.join(root,'src','guide.txt'),'NEEDLE');await git(root,['add','-A']);
 for(const within of ['.','./','.\\','src/','src\\','./src/']){const found=await searchSource.call(service,{query:'NEEDLE',within},noSearch);assert.equal(found.results.length,1);assert.equal(found.results[0].path,'src/guide.txt');}
 for(const within of ['../','..\\','C:\\outside','\\\\server\\share','/.env','src\\..\\.env'])await assert.rejects(searchSource.call(service,{query:'NEEDLE',within},noSearch),/path_scope/);
});
test('agent records a fixed source-search error, corrects the read and delivers its answer',async t=>{
 const {service}=await fixture(t);let round=0;
 const call=(name,args)=>({content:'',calls:[{id:String(round),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async()=>{
  if(++round===1)return call('source_search',{query:'first',within:'C:\\outside'});
  if(round===2)return call('read_source',{path:'app.txt'});
  return {content:'첫 줄은 first입니다.',calls:[]};
 }};
 const {installAgent}=await import('../runtime/agent.mjs');const {ProjectService}=await import('../runtime/project-service.mjs');installAgent(ProjectService);
 const task=await service.createTask({request:'app.txt의 첫 줄을 확인해 주세요.'});await service.startAgent({taskId:task.id});await service.agent.promise;const result=service.task(task.id);
 assert.equal(result.state,'review',JSON.stringify(result.recovery));assert.equal(result.messages.at(-1).content,'첫 줄은 first입니다.');assert(result.trace.some(event=>event.tool==='source_search'&&event.status==='error'&&event.reason==='path_scope'));assert(result.trace.some(event=>event.tool==='read_source'&&event.status==='done'));assert(!JSON.stringify(result.trace).includes('C:\\\\outside'));
});
