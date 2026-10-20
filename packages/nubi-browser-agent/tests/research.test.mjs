import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentResearchPort,withDocumentReadContinuation} from '../dist/research.js';
import {deferred} from './host.mjs';

function setup(concurrency=1){
 const controller=new AbortController(),ctx={lease:'lease',signal:controller.signal,owner:{},scope:{}},links=['a','b','c'].map(linkId=>({linkId,title:linkId,url:'https://example.test/'+linkId}));let valid=true,released=false,reads=[];
 const observation={state:'ready',observationId:'o1',binding:{tabId:'t1',documentId:'d1',revision:'r1'},data:{snapshot:'Current host evidence'}};
 const base={acquire:async()=>ctx.lease,release:async()=>{released=true;},tools:async()=>[],observe:async()=>structuredClone(observation),validate:async()=>valid,execute:async()=>{throw Error('unexpected');},reconcile:async()=>{},verify:async()=>{}};
 const source=link=>({sourceId:'source:'+link.linkId,url:link.url,title:link.title,text:'Fresh public evidence',truncated:false,observedAt:new Date().toISOString(),contentHash:'sha256:'+'a'.repeat(64)});
 const documents={capture:async()=>links,validate:async()=>valid,read:async(_ctx,link)=>{reads.push(link.linkId);return source(link);}};
 const port=createDocumentResearchPort({browser:base,documents,concurrency}),action=ids=>({actionId:'action',tool:'browser_read_documents',observationId:'o1',arguments:{linkIds:ids},binding:observation.binding,catalogVersion:1});
 return {port,documents,ctx,controller,links,source,action,reads,get released(){return released;},invalidate(){valid=false;}};
}
async function ready(f){await f.port.acquire({});return f.port.observe(f.ctx,'t1');}
test('declared document titles resolve only to unique fresh links, never guessed URLs or overlapping targets',async()=>{
 const base={lookup:async()=>({notes:[],procedures:[]}),run:async()=>({})},memory=withDocumentReadContinuation(base);let requests=[];
 const context={observation:{data:{documentLinks:[{linkId:'fresh-a',title:'Alpha document',url:'https://example.test/a'},{linkId:'fresh-b',title:'Beta document',url:'https://example.test/b'}]}}},api={act:async(name,args)=>{requests.push({name,args});return {};}};
 await memory.followUp.run({titles:['Alpha','Beta']},context,api);assert.deepEqual(requests,[{name:'browser_read_documents',args:{linkIds:['fresh-a','fresh-b']}}]);requests=[];
 assert.equal((await memory.followUp.run({titles:['document']},context,api)).error,'document_intent_ambiguous');assert.equal((await memory.followUp.run({titles:['Missing']},context,api)).error,'document_intent_missing');assert.equal((await memory.followUp.run({titles:['Alpha','Alpha document']},context,api)).error,'document_intent_overlap');assert.equal(requests.length,0);
});
test('document reads accept only exact current links and never model URLs or duplicate IDs',async()=>{
 const f=setup();await ready(f);for(const ids of [['unknown'],['a','a'],['https://example.test/a']])await assert.rejects(f.port.execute(f.ctx,f.action(ids)));assert.equal(f.reads.length,0);
 await assert.rejects(f.port.execute(f.ctx,{...f.action(['a']),arguments:{linkIds:['a'],url:'https://example.test/a'}}));
 const result=await f.port.execute(f.ctx,f.action(['a','b']));assert.equal(result.status,'confirmed');assert.deepEqual(result.evidenceRefs,['source:a','source:b']);assert.equal(result.observation.observationId,'o1');await f.port.release(f.ctx.lease);
});
test('bounded parallel read preserves result order and never exceeds its concurrency',async()=>{
 const f=setup(2),barrier=deferred();let running=0,peak=0,started=0;f.documents.read=async(_ctx,link)=>{running++;peak=Math.max(peak,running);if(++started===2)barrier.resolve();await barrier.promise;running--;return f.source(link);};await ready(f);
 const result=await f.port.execute(f.ctx,f.action(['c','a','b']));assert.equal(peak,2);assert.deepEqual(result.data.documents.map(x=>x.linkId),['c','a','b']);await f.port.release(f.ctx.lease);
});
test('a stale source cannot start document reads and stale results never publish',async()=>{
 const f=setup();await ready(f);f.invalidate();await assert.rejects(f.port.execute(f.ctx,f.action(['a'])),/binding_changed/);assert.equal(f.reads.length,0);
 const g=setup();await ready(g);g.documents.read=async(_ctx,link)=>{g.invalidate();return g.source(link);};await assert.rejects(g.port.execute(g.ctx,g.action(['a'])),/binding_changed/);await g.port.release(g.ctx.lease);await f.port.release(f.ctx.lease);
});
test('release and cancellation wait for physical document read settlement',async()=>{
 const f=setup(),started=deferred(),finish=deferred();f.documents.read=async(_ctx,link)=>{started.resolve();await finish.promise;return f.source(link);};await ready(f);const reading=f.port.execute(f.ctx,f.action(['a']));await started.promise;const rejected=assert.rejects(reading);f.controller.abort();const release=f.port.release(f.ctx.lease);assert.equal(f.released,false);finish.resolve();await rejected;await release;assert.equal(f.released,true);
});
test('one failed read keeps explicit partial evidence and never pretends all requested documents were read',async()=>{
 const f=setup();f.documents.read=async(_ctx,link)=>{if(link.linkId==='b')throw Error('sensitive details');return f.source(link);};await ready(f);const result=await f.port.execute(f.ctx,f.action(['a','b']));assert.deepEqual(result.evidenceRefs,['source:a']);assert.equal(result.data.documents[1].error,'document_read_failed');assert.ok(!JSON.stringify(result).includes('sensitive details'));await f.port.release(f.ctx.lease);
});
test('a post-action enrichment error preserves the confirmed write receipt',async()=>{
 const f=setup();await ready(f);f.documents.capture=async()=>{throw Error('changed during post-action read');};
 // A separate host base delivers a confirmed receipt then an invalidated read.
 const base={acquire:async()=>f.ctx.lease,release:async()=>{},tools:async()=>[],observe:async()=>({state:'ready',binding:f.action(['a']).binding,observationId:'new'}),validate:async()=>true,execute:async()=>({status:'confirmed',evidenceRefs:['write:confirmed'],observation:{state:'ready',binding:f.action(['a']).binding,observationId:'new'}})};
 const p=createDocumentResearchPort({browser:base,documents:f.documents});await p.acquire({});const result=await p.execute(f.ctx,{...f.action(['a']),tool:'browser_press_key'});assert.equal(result.status,'confirmed');assert.deepEqual(result.evidenceRefs,['write:confirmed']);assert.equal(result.observation,undefined);await p.release(f.ctx.lease);await f.port.release(f.ctx.lease);
});
test('post-action observation repair repeats only the read and returns a fresh binding in the same tool turn',async()=>{
 const f=setup();let captures=0,writes=0,reads=0;const fresh={state:'ready',binding:{tabId:'t1',documentId:'next',revision:'r2'},observationId:'fresh'};
 f.documents.capture=async()=>{if(++captures===1)throw Error('transient invalidation');return [];};
 const base={acquire:async()=>f.ctx.lease,release:async()=>{},tools:async()=>[],validate:async()=>true,observe:async()=>{reads++;return fresh;},execute:async()=>{writes++;return {status:'confirmed',evidenceRefs:['write:one'],observation:{...fresh,observationId:'invalidated'}};}};
 const p=createDocumentResearchPort({browser:base,documents:f.documents});await p.acquire({});const result=await p.execute(f.ctx,{...f.action(['a']),tool:'browser_press_key'});assert.equal(writes,1);assert.equal(reads,1);assert.equal(result.status,'confirmed');assert.equal(result.observation.observationId,'fresh');await p.release(f.ctx.lease);
});

test('single-character subject names are valid when unique, while blank and ambiguous names never read',async()=>{
 const memory=withDocumentReadContinuation({lookup:async()=>({notes:[],procedures:[]}),run:async()=>({})});let reads=0;
 const context={observation:{data:{documentLinks:[{linkId:'book',title:'검색 > 책 - Search API',url:'https://example.test/book'},{linkId:'other',title:'검색 > 백과 사전',url:'https://example.test/other'}]}}},api={act:async(name,args)=>{reads++;assert.deepEqual(args.linkIds,['book']);return {};}};
 await memory.followUp.run({titles:['책']},context,api);assert.equal(reads,1);await assert.rejects(memory.followUp.run({titles:[' ']},context,api),/document_intent_invalid/);assert.equal((await memory.followUp.run({titles:['검']},context,api)).error,'document_intent_ambiguous');assert.equal(reads,1);
});

test('read continuation refreshes stale evidence once, preserving original subjects and URLs',async()=>{
 for(const mode of ['throw','receipt']){let calls=0,observed=0;const memory=withDocumentReadContinuation({lookup:async()=>({notes:[],procedures:[]}),run:async()=>({})}),context={signal:new AbortController().signal,observation:{state:'ready',data:{documentLinks:[{linkId:'old',title:'Alpha',url:'https://example.test/a'}]}}};
 const {BrowserAgentError}=await import('../dist/index.js');const api={observe:async()=>{observed++;return {state:'ready',data:{documentLinks:[{linkId:'new',title:'Alpha',url:'https://example.test/a'}]}};},act:async(name,args)=>{assert.equal(name,'browser_read_documents');if(++calls===1){if(mode==='throw')throw new BrowserAgentError('binding_changed');return {error:'execution_not_started',receipt:{status:'not_started'}};}assert.deepEqual(args.linkIds,['new']);return {data:{source:'fresh'}};}};
 const result=await memory.followUp.run({titles:['Alpha']},context,api);assert.equal(result.data.source,'fresh');assert.equal(result.readRecovery.attempts,2);assert.equal(calls,2);assert.equal(observed,1);}
});
for(const mode of ['changed-url','ambiguous','forbidden','unconfirmed','confirmed','waiting','missing-receipt','unknown-error','repeated'])test('read continuation retry respects '+mode+' boundary',async()=>{
 const {BrowserAgentError}=await import('../dist/index.js');let calls=0;const memory=withDocumentReadContinuation({lookup:async()=>({notes:[],procedures:[]}),run:async()=>({})});const link={linkId:'old',title:'Alpha',url:'https://example.test/a'},context={signal:new AbortController().signal,observation:{state:'ready',data:{documentLinks:[link]}}};
 const outcome={error:'execution_not_started',receipt:{status:'not_started'}};if(['confirmed','unconfirmed'].includes(mode))outcome.receipt.status=mode;if(mode==='waiting')outcome.requiresUserInput=true;if(mode==='missing-receipt')delete outcome.receipt;
 const api={act:async()=>{calls++;if(mode==='unknown-error')throw new BrowserAgentError('policy_denied');return outcome;},observe:async()=>({state:mode==='forbidden'?'forbidden':'ready',data:{documentLinks:[{...link,linkId:'new',...(mode==='changed-url'?{url:'https://example.test/other'}:{})},...(mode==='ambiguous'?[{...link,linkId:'second'}]:[])]}})};
 if(mode==='unknown-error')await assert.rejects(memory.followUp.run({titles:['Alpha']},context,api),/policy_denied/);else await memory.followUp.run({titles:['Alpha']},context,api);assert.equal(calls,mode==='repeated'?2:1);
});
