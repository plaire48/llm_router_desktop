import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditorSession,createMonacoEditorPort,createObsidianEditorPort,createEditorSkill} from '../dist/editors.js';

const scope={projectId:'project',taskId:'task'},signal=()=>new AbortController().signal;
function fixture(kind='monaco',initial='---\ntitle: 업무\n---\n안녕하세요 [[연결]]\n마지막 줄\n') {
 let text=initial,revision=1,connected=true,readOnly=false,dirty=true,writes=0,undoStops=0;
 const offset=pos=>text.split('\n').slice(0,pos.line).reduce((n,line)=>n+line.length+1,0)+pos.ch;
 const position=n=>{const lines=text.slice(0,n).split('\n');return {line:lines.length-1,ch:lines.at(-1).length};};
 const getSelection=()=>({from:position(text.indexOf('안녕하세요')<0?0:text.indexOf('안녕하세요')),to:position(text.indexOf('안녕하세요')<0?0:text.indexOf('안녕하세요')+5)});
 const change=(value,start,end)=>{text=text.slice(0,start)+value+text.slice(end);revision++;writes++;};
 const model={getValue:()=>text,getVersionId:()=>revision,isDisposed:()=>!connected,getOffsetAt:p=>offset({line:p.lineNumber-1,ch:p.column-1}),getPositionAt:n=>{const p=position(n);return {lineNumber:p.line+1,column:p.ch+1};}};
 const editor=kind==='monaco'?{
  getModel:()=>model,getSelection:()=>{const {from,to}=getSelection();return {startLineNumber:from.line+1,startColumn:from.ch+1,endLineNumber:to.line+1,endColumn:to.ch+1};},
  pushUndoStop:()=>{undoStops++;return true;},executeEdits:(_source,[edit])=>{change(edit.text,model.getOffsetAt({lineNumber:edit.range.startLineNumber,column:edit.range.startColumn}),model.getOffsetAt({lineNumber:edit.range.endLineNumber,column:edit.range.endColumn}));return true;}
 }:{getValue:()=>text,getCursor:side=>getSelection()[side],posToOffset:offset,offsetToPos:position,replaceRange:(value,from,to)=>change(value,offset(from),offset(to))};
 const connection={connectionId:'connection',documentId:'업무/보고.md',editor,isConnected:()=>connected,readOnly:()=>readOnly,dirty:()=>dirty,revision:()=>revision};
 const port=kind==='monaco'?createMonacoEditorPort(connection):createObsidianEditorPort(connection);
 const session=createEditorSession(port,scope),records=[],claims=new Set();
 const host={policy:{authorize:async()=>true},claim:async p=>{if(claims.has(p.approvalId))return false;claims.add(p.approvalId);return true;},record:async(p,r)=>records.push({p,r})};
 return {port,session,host,records,connection,model,get text(){return text;},get writes(){return writes;},get undoStops(){return undoStops;},mutate:value=>{text=value;revision++;},disconnect:()=>{connected=false;},lock:()=>{readOnly=true;}};
}
async function proposal(f,newText='반갑습니다') {
 const r=await f.session.read({selection:true},signal());
 return f.session.propose({observationId:r.observationId,start:r.offset,end:r.end,oldText:r.text,newText},signal());
}

for(const kind of ['monaco','obsidian']) {
 test(`${kind}: live selection edit preserves frontmatter, links and all other text`,async()=>{
  const f=fixture(kind),before=f.text,p=await proposal(f);
  assert.equal(p.binding.mode,kind==='monaco'?'internal':'external');
  const result=await f.session.apply(p.approvalId,f.host,signal());
  assert.equal(result.status,'verified');assert.equal(result.saveStatus,'not_requested');
  assert.equal(f.text,before.replace('안녕하세요','반갑습니다'));assert.equal(f.writes,1);
  assert.equal(f.records.length,1);assert.ok(result.receiptId);
  if(kind==='monaco')assert.equal(f.undoStops,2);
 });
 test(`${kind}: concurrent user edit blocks stale proposal`,async()=>{
  const f=fixture(kind),p=await proposal(f);f.mutate(f.text+'사용자 수정');
  await assert.rejects(f.session.apply(p.approvalId,f.host,signal()),/editor_changed/);assert.equal(f.writes,0);
 });
 test(`${kind}: change during durable claim is caught in the app transaction`,async()=>{
  const f=fixture(kind),p=await proposal(f);f.host.claim=async()=>{f.mutate(f.text+'다른 내용');return true;};
  const r=await f.session.apply(p.approvalId,f.host,signal());
  assert.equal(r.status,'unconfirmed');assert.equal(f.writes,0); // Conservative host result: no replay.
 });
 test(`${kind}: disconnect keeps the original buffer`,async()=>{
  const f=fixture(kind),before=f.text,p=await proposal(f);f.disconnect();
  await assert.rejects(f.session.apply(p.approvalId,f.host,signal()),/editor_disconnected/);assert.equal(f.text,before);
 });
 test(`${kind}: read-only buffer never writes`,async()=>{
  const f=fixture(kind);f.lock();await assert.rejects(proposal(f),/editor_read_only/);assert.equal(f.writes,0);
 });
}
test('only one concurrent call can use a proposal',async()=>{
 const f=fixture(),p=await proposal(f);
 const r=await Promise.allSettled([f.session.apply(p.approvalId,f.host,signal()),f.session.apply(p.approvalId,f.host,signal())]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.writes,1);
});
test('host approval checks exact proposal hash; denial consumes the attempt',async()=>{
 const f=fixture(),p=await proposal(f);f.host.policy.authorize=async v=>{assert.deepEqual(v,{...scope,approvalId:p.approvalId,fingerprint:p.fingerprint});return false;};
 await assert.rejects(f.session.apply(p.approvalId,f.host,signal()),/approval_required/);
 await assert.rejects(f.session.apply(p.approvalId,f.host,signal()),/proposal_unavailable/);assert.equal(f.writes,0);
});
test('host durable claim rejects replay before dispatch',async()=>{
 const f=fixture(),p=await proposal(f);f.host.claim=async()=>false;
 await assert.rejects(f.session.apply(p.approvalId,f.host,signal()),/already_claimed/);assert.equal(f.writes,0);
});
test('cancellation after claim cannot dispatch',async()=>{
 const f=fixture(),p=await proposal(f),controller=new AbortController();
 f.host.claim=async()=>{controller.abort();return true;};
 await assert.rejects(f.session.apply(p.approvalId,f.host,controller.signal),/cancelled/);assert.equal(f.writes,0);
});
test('lost response after edit is unconfirmed and cannot resend',async()=>{
 const f=fixture(),original=f.port.replaceIfCurrent;
 f.port.replaceIfCurrent=async(...args)=>{await original(...args);throw Error('transport lost');};
 const p=await proposal(f),r=await f.session.apply(p.approvalId,f.host,signal());
 assert.equal(r.status,'unconfirmed');assert.equal(f.writes,1);
 await assert.rejects(f.session.apply(p.approvalId,f.host,signal()),/unavailable/);assert.equal(f.writes,1);
});
test('independent readback detects collateral changes',async()=>{
 const f=fixture(),original=f.port.replaceIfCurrent;
 f.port.replaceIfCurrent=async(...args)=>{const r=await original(...args);f.mutate(f.text+'unexpected');return r;};
 const p=await proposal(f);assert.equal((await f.session.apply(p.approvalId,f.host,signal())).status,'verification_failed');
});
test('missing receipt is never verified',async()=>{
 const f=fixture();f.port.replaceIfCurrent=async()=>({status:'confirmed'});
 const p=await proposal(f);assert.equal((await f.session.apply(p.approvalId,f.host,signal())).status,'unconfirmed');
});
test('range projection does not duplicate bodies or expose unread content',async()=>{
 const f=fixture('monaco','가'.repeat(30000)),r=await f.session.read({limit:100},signal());
 assert.equal(r.text.length,100);assert.equal(r.nextOffset,100);assert.equal(r.partial,true);
 assert.ok(JSON.stringify(r).length<1000);
 await assert.rejects(f.session.propose({observationId:r.observationId,start:99,end:101,oldText:'가가',newText:'나'},signal()),/not_observed/);
});
test('UTF-16 offsets cannot split an emoji',async()=>{
 const f=fixture('monaco','가😀나'),r=await f.session.read({limit:2},signal());assert.equal(r.text,'가');assert.equal(r.nextOffset,1);
 await assert.rejects(f.session.read({offset:2},signal()),/range_invalid/);
 await assert.rejects(f.session.read({offset:1,limit:1},signal()),/range_limit/);
});
test('returned proposal and source objects cannot mutate private approval',async()=>{
 const f=fixture(),p=await proposal(f);p.patch.newText='tampered';p.binding.documentId='another.md';
 assert.equal((await f.session.apply(p.approvalId,f.host,signal())).status,'verified');assert.ok(!f.text.includes('tampered'));
});
test('existing model loop skill only exposes read and proposal, never write/save',async()=>{
 const f=fixture(),skill=createEditorSkill(f.session,signal());
 assert.deepEqual(skill.tools.map(t=>t.name),['read_editor_range','propose_editor_edit']);
 const r=await skill.executeTool({id:'read',name:'read_editor_range',input:{selection:true}});
 assert.equal(JSON.parse(r.output).text,'안녕하세요');assert.equal(f.writes,0);
});
test('a different document cannot replace the pinned document even when text matches',async()=>{
 const f=fixture(),p=await proposal(f),inspect=f.port.inspect;
 f.port.inspect=async s=>({...await inspect(s),binding:{...(await inspect(s)).binding,documentId:'different.md'}});
 await assert.rejects(f.session.apply(p.approvalId,f.host,signal()),/binding_changed/);assert.equal(f.writes,0);
});
test('disconnect revokes prior observations and proposals without closing the app',async()=>{
 const f=fixture(),p=await proposal(f),text=f.text;f.session.disconnect();
 await assert.rejects(f.session.apply(p.approvalId,f.host,signal()),/disconnected/);assert.equal(f.text,text);
});
