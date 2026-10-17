import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {openOfficeProcess} from '../runtime/external-office-process.mjs';

function fixture(connection={app:'word',documentId:'doc',documentTitle:'보고서.docx',officeVersion:'16.0'}){
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.killed=false;child.kill=()=>{child.killed=true;queueMicrotask(()=>child.emit('close',null,'SIGTERM'));};
 const sent=[];let buffered='';child.stdin.on('data',chunk=>{buffered+=chunk;while(buffered.includes('\n')){const i=buffered.indexOf('\n');sent.push(JSON.parse(buffered.slice(0,i)));buffered=buffered.slice(i+1);}});
 const emit=value=>child.stdout.write(JSON.stringify(value)+'\n');
 const opening=openOfficeProcess({app:'word',executable:'/trusted/Office.exe',platform:'win32',spawnProcess:()=>child,timeoutMs:40,startupMs:1000});
 emit({type:'ready',protocol:1,sessionId:'session',connection});
 return {child,emit,sent,opening};
}
test('one bound process carries ordered calls without exposing a shell or replaying writes',async()=>{
 const h=fixture(),host=await h.opening,p=host.call('inspect_office',{steps:[{action:'get',member:'Name'}]});
 assert.equal(h.sent.length,1);assert.equal(h.sent[0].sessionId,'session');
 await assert.rejects(host.call('calculate_office',{}),/busy/);
 h.emit({type:'result',sessionId:'session',id:h.sent[0].id,sequence:1,result:{snapshotId:'s',results:['보고서.docx']}});
 assert.equal((await p).snapshotId,'s');assert.equal(h.sent.length,1);host.close();
});
test('a mismatched reply closes the binding; a dispatched write stays uncertain',async()=>{
 const h=fixture(),host=await h.opening,p=host.call('execute_office_operations',{steps:[]});
 h.emit({type:'result',sessionId:'other',id:h.sent[0].id,sequence:1,result:{status:'verified'}});
 await assert.rejects(p,e=>e.writeResultUncertain===true&&e.message==='native_office_protocol_invalid');assert.equal(h.child.killed,true);
 await assert.rejects(host.call('execute_office_operations',{}),/closed/);assert.equal(h.sent.length,1);
});
test('timeout and abort never resend an uncertain mutation',async()=>{
 for(const mode of ['timeout','abort']){
  const h=fixture(),host=await h.opening,c=new AbortController(),p=host.call('execute_office_operations',{},c.signal);
  if(mode==='abort')c.abort();
  await assert.rejects(p,e=>e.writeResultUncertain===true);assert.equal(h.sent.length,1);assert.equal(h.child.killed,true);
 }
});
test('oversized input, unsupported methods and already aborted calls never dispatch',async()=>{
 const h=fixture(),host=await h.opening;
 await assert.rejects(host.call('eval',{}),/method/);
 await assert.rejects(host.call('inspect_office',{text:'x'.repeat(300001)}),/limit/);
 const c=new AbortController();c.abort();await assert.rejects(host.call('inspect_office',{},c.signal));assert.equal(h.sent.length,0);host.close();
});
test('native error details stay bounded and no stderr content becomes a user error',async()=>{
 const h=fixture(),host=await h.opening,p=host.call('inspect_office',{});h.child.stderr.write('private contents');
 h.emit({type:'result',sessionId:'session',id:h.sent[0].id,sequence:1,error:'private contents'});await assert.rejects(p,/native_office_call_failed/);host.close();
});
test('non-Windows hosts do not start the native executable',async()=>{let spawned=false;await assert.rejects(openOfficeProcess({app:'word',executable:'/trusted/exe',platform:'darwin',spawnProcess(){spawned=true;}}),/windows_required/);assert.equal(spawned,false);});
test('UTF-8 split across pipe chunks preserves Korean document text',async()=>{const h=fixture(),host=await h.opening,p=host.call('inspect_office',{});const bytes=Buffer.from(JSON.stringify({type:'result',sessionId:'session',id:h.sent[0].id,sequence:1,result:{results:['한글 본문']}})+'\n');for(const byte of bytes)h.child.stdout.write(Buffer.from([byte]));assert.deepEqual((await p).results,['한글 본문']);host.close();});

const candidateId='a'.repeat(32),choices={app:'word',selectionRequired:true,documents:[{candidateId,documentTitle:'보고서',windowNumber:1}]};
test('unbound helper exposes choices and only selected response establishes document metadata',async()=>{const h=fixture(choices),host=await h.opening;assert.equal(host.selectionRequired,true);await assert.rejects(host.call('inspect_office',{}),/selection_required/);await assert.rejects(host.call('bind_document',{candidateId:'invented'}),/selection_changed/);assert.equal(h.sent.length,0);const selected=host.call('bind_document',{candidateId});h.emit({type:'result',sessionId:'session',id:h.sent[0].id,sequence:1,result:{app:'word',candidateId,documentId:'selected-document',documentTitle:'보고서',officeVersion:'16.0'}});await selected;assert.equal(host.selectionRequired,false);assert.equal({...host}.documentId,'selected-document');await assert.rejects(host.call('bind_document',{candidateId}),/selection_changed/);host.close();});
test('a response for a different candidate retires the helper instead of binding another window',async()=>{const h=fixture(choices),host=await h.opening,p=host.call('bind_document',{candidateId});h.emit({type:'result',sessionId:'session',id:h.sent[0].id,sequence:1,result:{app:'word',candidateId:'b'.repeat(32),documentId:'wrong',documentTitle:'보고서'}});await assert.rejects(p,/protocol_invalid/);assert.equal(host.isAlive(),false);assert.equal(host.documentId,undefined);});
test('duplicate discovery IDs fail closed before a candidate can be selected',async()=>{const h=fixture({...choices,documents:[...choices.documents,...choices.documents]});await assert.rejects(h.opening,/protocol_invalid/);assert.equal(h.child.killed,true);});
