import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createScreenKnowledge} from '../dist/knowledge.js';
import {createWikiScreenStore,screenWikiPath,parseScreenWiki} from '../dist/knowledge-wiki.js';
import {fileWikiDocuments} from '../evaluation/wiki-document-host.mjs';
import {createFileWikiDocuments} from '../dist/knowledge-files.js';
import {retrieveWikiEvidence} from '../../openwiki/dist/visualize/retrieval.js';

const scope={projectId:'p1',systemId:'system-one',environmentId:'test',accessScopeId:'reader'};
const signal=()=>new AbortController().signal;
const facts=[{id:'f0',kind:'heading',text:'자료 검색',context:''},{id:'f1',kind:'field',text:'검색어',context:''},{id:'f2',kind:'action',text:'조회',context:''}];
const evidence=()=>({screenId:'search',variantId:'default',fingerprint:'sha256:'+createHash('sha256').update(JSON.stringify(facts)).digest('hex'),observedAt:new Date().toISOString(),facts:structuredClone(facts),coverage:{partial:false,frames:1}});
const analysis={screenType:'search',titleEvidenceId:'f0',fieldEvidenceIds:['f1'],actionEvidenceIds:['f2']};
async function setup(t,changes={}){
 const root=await mkdtemp(join(tmpdir(),'nubi-screen-wiki-'));t.after(()=>rm(root,{recursive:true,force:true}));let calls=0,current=evidence(),valid=true;
 const source={observe:async()=>structuredClone(current),validate:async()=>valid};
 const store=createWikiScreenStore(fileWikiDocuments(root));
 const analyzer={id:'test-host',analyze:async()=>{calls++;return structuredClone(analysis);}};
 const options={scope,source,store,analyzer,...changes};return {root,source,store,analyzer,options,service:createScreenKnowledge(options),calls:()=>calls,setCurrent:x=>{current=x;},invalidate:()=>{valid=false;}};
}
test('screen knowledge persists as OpenWiki Markdown and a new module instance retrieves it without another model call',async t=>{
 const x=await setup(t);const first=await x.service.analyzeAndSave(signal());assert.equal(first.reused,false);assert.equal(x.calls(),1);
 const path=await screenWikiPath(scope,'search','default'),content=await readFile(join(x.root,path),'utf8');assert.match(content,/입력 항목/);assert.match(content,/검색어/);
 const next=createScreenKnowledge({...x.options,store:createWikiScreenStore(fileWikiDocuments(x.root))});const recalled=await next.recall(signal());assert.equal(recalled.status,'matched');assert.match(recalled.notes[0],/조회/);assert.equal((await next.analyzeAndSave(signal())).reused,true);assert.equal(x.calls(),1);
 const found=retrieveWikiEvidence([{id:path,title:'자료 검색',raw:content}],'검색어 조회',3);assert.ok(found.results.length>0,'existing OpenWiki search reads the saved Markdown');
});
test('changed screen stays stale, and fresh analysis updates by CAS rather than replaying a procedure',async t=>{
 const x=await setup(t);await x.service.analyzeAndSave(signal());const next=evidence();next.fingerprint='sha256:'+'b'.repeat(64);x.setCurrent(next);assert.equal((await x.service.recall(signal())).status,'stale');assert.equal((await x.service.recall(signal())).notes.length,0);
 await x.service.analyzeAndSave(signal());assert.equal(x.calls(),2);assert.equal((await x.service.recall(signal())).status,'matched');
});
test('different system, environment and access scope never read another scope wiki',async t=>{
 const x=await setup(t);await x.service.analyzeAndSave(signal());for(const key of ['projectId','systemId','environmentId','accessScopeId']){const service=createScreenKnowledge({...x.options,scope:{...scope,[key]:'different'}});assert.equal((await service.recall(signal())).status,'missing');}
});
test('forged citations, changed evidence and cancellation do not publish a wiki',async t=>{
 for(const mode of ['forged','changed','cancelled']){
  const x=await setup(t);const controller=new AbortController();x.analyzer.analyze=async()=>{if(mode==='changed')x.invalidate();if(mode==='cancelled')controller.abort();return {...analysis,...(mode==='forged'?{fieldEvidenceIds:['invented']}:{})};};
  await assert.rejects(x.service.analyzeAndSave(controller.signal));assert.equal(await x.store.read(scope,'search','default',signal()),null);
 }
});
test('manual wiki changes are preserved and a competing candidate cannot overwrite the winner',async t=>{
 const x=await setup(t);await x.service.analyzeAndSave(signal());const path=await screenWikiPath(scope,'search','default'),file=join(x.root,path),original=await readFile(file,'utf8');
 await writeFile(file,original.replace('입력 항목','Human edited fields'));await assert.rejects(x.service.analyzeAndSave(signal(),{force:true}),/screen_wiki_changed/);assert.match(await readFile(file,'utf8'),/Human edited/);
 const y=await setup(t),r={schemaVersion:1,scope,evidence:evidence(),analysis,analyzerId:'test-host'};const writes=await Promise.all([y.store.compareAndSet(null,r,signal()),y.store.compareAndSet(null,r,signal())]);assert.equal(writes.filter(Boolean).length,1);
});
test('Pi memory composition adds historical notes and preserves the injected procedure owner',async t=>{
 const x=await setup(t);await x.service.analyzeAndSave(signal());let ran=0;const base={lookup:async()=>({notes:['existing note'],procedures:[{id:'procedure',version:1,title:'Existing',inputs:[]}]}),run:async()=>{ran++;return {done:true};}};
 const memory=x.service.memory(base),context={projectId:scope.projectId,signal:signal()};const got=await memory.lookup(context);assert.equal(got.notes.length,2);assert.equal(got.procedures[0].id,'procedure');await memory.run({},context,{});assert.equal(ran,1);
 await assert.rejects(memory.lookup({...context,projectId:'other'}),/knowledge_scope_invalid/);
});

test('an uncooperative analyzer is cancelled promptly and cannot publish a late result',async t=>{
 const x=await setup(t),controller=new AbortController();let release,entered;const started=new Promise(r=>{entered=r;});x.analyzer.analyze=async()=>{entered();return new Promise(r=>{release=r;});};
 const pending=x.service.analyzeAndSave(controller.signal);await started;controller.abort();await assert.rejects(pending);release(analysis);await new Promise(r=>setImmediate(r));assert.equal(await x.store.read(scope,'search','default',signal()),null);
});

test('a forged matching fingerprint cannot make changed facts current, and store readback is mandatory',async t=>{
 const x=await setup(t);await x.service.analyzeAndSave(signal());const changed=evidence();changed.facts[1].text='변경된 필드';x.setCurrent(changed);assert.equal((await x.service.recall(signal())).status,'stale');
 const y=await setup(t,{store:{read:async()=>null,compareAndSet:async()=>true}});await assert.rejects(y.service.analyzeAndSave(signal()),/screen_wiki_readback_failed/);
});

test('the optional file adapter enforces host authorization, scope identity and symlink boundaries',async t=>{
 const x=await setup(t),path=await screenWikiPath(scope,'search','default');const denied=createFileWikiDocuments({root:x.root,authorize:async()=>false});await assert.rejects(denied.read(path,scope,signal()),/wiki_access_denied/);
 await x.service.analyzeAndSave(signal());const documents=createFileWikiDocuments({root:x.root,authorize:async()=>true});await assert.rejects(documents.read(path,{...scope,accessScopeId:'other'},signal()),/screen_store_scope_mismatch/);
 const y=await setup(t);await symlink(x.root,join(y.root,'openwiki'));const unsafe=createFileWikiDocuments({root:y.root,authorize:async()=>true});await assert.rejects(unsafe.read(path,scope,signal()),/wiki_path_invalid/);
});
