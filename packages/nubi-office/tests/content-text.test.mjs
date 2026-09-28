import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createContentText} from '../worker/content-text.mjs';
import {contentTextIncomplete,validateContentText} from '../worker/content-integrity.mjs';
import {contentEvidence} from '../worker/content-context.mjs';
import {analysisTaskContext} from '../worker/analysis-jobs.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
function setup(text='앞'.repeat(7999)+'😀'+'끝'.repeat(4000),field='text'){
  const item={id:'p-1',kind:'paragraph',text:field==='text'?text.slice(0,4000):'제목',editable:false,truncated:true,[field+'Length']:text.length,[field+'Hash']:hash(text)};
  if(field==='notes'){item.notes=text.slice(0,4000);item.notesTruncated=true;}
  const page={host:field==='notes'?'powerpoint':'word',scopeId:'s',documentId:'s',fingerprint:'f',offset:0,total:1,nextOffset:null,items:[item]},pages=new Map([[0,page]]),calls=[],controller=new AbortController();
  let mutate=v=>v;
  const store=createContentText({pages,signal:controller.signal,call:async(name,payload)=>{
    calls.push({name,...payload});const chunk=text.slice(payload.offset,payload.offset+payload.maxChars),end=payload.offset+chunk.length;
    return mutate({host:page.host,scopeId:'s',documentId:'s',fingerprint:'f',itemId:item.id,field,offset:payload.offset,text:chunk,textLength:text.length,textHash:hash(text),chunkHash:hash(chunk),nextOffset:end<text.length?end:null,readOnly:true});
  }});
  return{store,pages,page,item,calls,controller,text,setMutate:fn=>{mutate=fn;}};
}
test('hydrate checks exact UTF16 coverage and hashes while preserving raw native pages',async()=>{
  const f=setup(),before=structuredClone(f.page),projected=await f.store.hydrate();
  assert.equal(projected.get(0).items[0].text,f.text);assert.deepEqual(f.page,before);assert.equal(contentTextIncomplete(projected.get(0).items[0]),false);
  assert.equal(contentEvidence(projected,true).length,1);assert.equal(f.calls.length,2);assert.equal(f.calls[0].name,'office_read_text');
  await f.store.hydrate();assert.equal(f.calls.length,2);projected.get(0).items[0].text='poison';assert.equal(f.store.project().get(0).items[0].text,f.text);
});
test('tail-only and out-of-order reads are not mistaken for complete evidence',async()=>{
  const f=setup();await f.store.read({itemId:'p-1',field:'text',offset:8000,maxChars:8000});
  assert.equal(contentTextIncomplete(f.store.project().get(0).items[0]),true);
  await f.store.read({itemId:'p-1',field:'text',offset:0,maxChars:8000});assert.equal(f.store.project().get(0).items[0].text,f.text);
});
test('PPT notes truncation is validated separately from a complete title',async()=>{
  const f=setup('노트'.repeat(7000),'notes');validateContentText(f.item);
  const item=(await f.store.hydrate()).get(0).items[0];assert.equal(item.text,'제목');assert.equal(item.notes,f.text);assert.equal(contentTextIncomplete(item),false);validateContentText(item);
  assert.throws(()=>validateContentText({...f.item,notesLength:2}),/observation_invalid/);
});
test('forged chunks, hashes, offsets, final cursors and stale binding never enter evidence',async()=>{
  const changes=[v=>({...v,chunkHash:'0'.repeat(64)}),v=>({...v,textHash:'0'.repeat(64)}),v=>({...v,offset:1}),v=>({...v,nextOffset:null}),v=>({...v,fingerprint:'other'}),v=>({...v,readOnly:false})];
  for(const change of changes){const f=setup();f.setMutate(change);await assert.rejects(f.store.hydrate(),/observation_invalid|source_changed/);assert.equal(f.store.progress().length,0);}
});
test('consistent chunk hashes cannot forge the original full-field hash',async()=>{
  const f=setup();f.setMutate(v=>{if(v.offset){const text='X'.repeat(v.text.length);return{...v,text,chunkHash:hash(text)};}return v;});
  await assert.rejects(f.store.hydrate(),/observation_invalid/);
});
test('cancellation and source drift discard late chunks',async()=>{
  for(const change of ['cancel','source']){const f=setup();f.setMutate(v=>{if(change==='cancel')f.controller.abort();else f.page.fingerprint='new';return v;});
    await assert.rejects(f.store.hydrate(),/cancelled|source_changed/);assert.equal(f.store.progress().length,0);}
});
test('legacy unknown truncation and aggregate ceilings fail before extra native calls',async()=>{
  const f=setup();delete f.item.textHash;assert.equal(contentTextIncomplete(f.store.project().get(0).items[0]),true);await assert.rejects(f.store.hydrate(),/evidence_incomplete/);assert.equal(f.calls.length,0);
  const g=setup('a'.repeat(2000001));await assert.rejects(g.store.hydrate(),/evidence_limit/);assert.equal(g.calls.length,0);
});
test('unchanged cached reads do not add progress and invalidation removes old evidence',async()=>{
  const f=setup(),args={itemId:'p-1',field:'text',offset:0,maxChars:4000};const value=await f.store.read(args),progress=structuredClone(f.store.progress());value.text='poison';await f.store.read(args);assert.deepEqual(f.store.progress(),progress);assert.equal(f.calls.length,1);
  f.store.clear();assert.deepEqual(f.store.progress(),[]);assert.equal(contentTextIncomplete(f.store.project().get(0).items[0]),true);
});
test('subagent parent context retains all 500 allowed requirement characters',()=>{
  const value={request:'작성',requirements:['요'.repeat(500)],answers:[]};assert.deepEqual(analysisTaskContext(value).requirements,value.requirements);assert.throws(()=>analysisTaskContext({...value,requirements:['요'.repeat(501)]}),/tool_arguments_invalid/);
});
test('smaller and overlapping rereads retain coverage and never manufacture progress',async()=>{
  const f=setup();await f.store.hydrate();const before=structuredClone(f.store.progress());
  for(const [offset,maxChars] of [[0,4000],[1000,5000],[0,8000]]){const result=await f.store.read({itemId:'p-1',field:'text',offset,maxChars});assert.equal(result.text,f.text.slice(offset,offset+maxChars));assert.equal(result.chunkHash,hash(result.text));assert.deepEqual(f.store.progress(),before);}
  assert.equal(f.store.project().get(0).items[0].text,f.text);assert.equal(f.calls.length,2);
});
