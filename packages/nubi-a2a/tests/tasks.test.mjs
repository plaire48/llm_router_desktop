import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createCollaborationServer} from '../server.mjs';
import {connectA2A,disconnectA2A,taskApi,locateHub} from '../client.mjs';
import {checkTaskResult} from '../tasks.mjs';
const records=()=>{const map=new Map();return {map,get:k=>map.get(k),set:(k,v)=>map.set(k,structuredClone(v)),list:p=>[...map].filter(([k])=>k.startsWith(p)).map(([,v])=>structuredClone(v))};};
const lookup={recipient:'browser',skill:'web-lookup',request:'행정안전부 공지 중 최신 글 제목과 날짜를 찾아 주세요.',urls:['https://www.mois.go.kr/'],facts:['제목','날짜']};
const found=runId=>({summary:'최신 공지는 9월 30일 게시글입니다.',facts:[{name:'제목',value:'2026년 하반기 안내',source_url:'https://www.mois.go.kr/notice/1',quote:'2026년 하반기 안내',evidenceId:'page-1'},{name:'날짜',value:'2026-09-30',evidenceId:'page-1'}],evidence:[{id:'page-1',url:'https://www.mois.go.kr/notice/1',title:'공지',capturedAt:'2026-10-01T01:00:00.000Z'}],verification:'host_checked',localRunId:runId});
async function hub(t,options={}){const events=[],server=await createCollaborationServer({records:records(),onTask:event=>events.push(event),...options});t.after(()=>server.close());return {server,events};}
const browser=async server=>taskApi(await connectA2A(server.invite('browser').url,'browser'));
const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const freePort=async()=>{const server=createServer(),port=await listen(server);await new Promise(resolve=>server.close(resolve));return port;};

test('desktop request waits for the browser user and returns sourced facts',async t=>{
 const {server,events}=await hub(t),web=await browser(server);
 const sent=await server.tasks.request(lookup);assert.equal(sent.state,'submitted');assert.equal(sent.requester,'desktop');
 const inbox=await web.list();assert.deepEqual(inbox.tasks.map(task=>[task.id,task.state,task.recipient]),[[sent.id,'submitted','browser']]);assert.deepEqual(inbox.tasks[0].urls,lookup.urls);
 await assert.rejects(web.complete(sent.id,found('run-1')),/a2a_state/,'A result before acceptance is refused');
 assert.equal((await server.tasks.get(sent.id)).state,'submitted','The refused result leaves the task as it was');
 assert.equal((await web.accept(sent.id)).state,'working');
 assert.equal((await web.progress(sent.id,'공지 목록을 읽는 중입니다.')).note,'공지 목록을 읽는 중입니다.');
 const done=await web.complete(sent.id,found('run-1'));
 assert.equal(done.state,'completed');assert.equal(done.result.facts[0].source_url,'https://www.mois.go.kr/notice/1');assert.equal(done.result.verification,'host_checked');assert.equal(done.result.from,'browser');
 assert.deepEqual(await server.tasks.get(sent.id),done);
 await settle();assert.deepEqual(events.map(event=>event.event),['created','accepted','progress','completed']);assert.equal(events.at(-1).task.result.localRunId,'run-1');
});
test('browser asks the desktop and each side only moves its own part',async t=>{
 const {server}=await hub(t),web=await browser(server);
 const sent=await web.request({recipient:'desktop',skill:'source-search',request:'로그인 실패 메시지를 만드는 코드를 찾아 주세요.'});assert.equal(sent.requester,'browser');
 await assert.rejects(web.accept(sent.id),/a2a_scope/,'The requester cannot accept its own task');
 await assert.rejects(server.tasks.cancel(sent.id),/a2a_scope/,'The recipient declines instead of cancelling');
 await server.tasks.accept(sent.id);
 const done=await server.tasks.complete(sent.id,{summary:'LoginService가 메시지를 만듭니다.',facts:[{name:'위치',value:'LoginService.java 42행',path:'src/main/java/LoginService.java',hash:'sha256:'+'b'.repeat(64)}],evidence:[],verification:'not_run',localRunId:'desktop-run'});
 assert.equal(done.result.facts[0].path,'src/main/java/LoginService.java');assert.equal((await web.get(sent.id)).state,'completed');
 await assert.rejects(web.cancel(sent.id),'A finished task cannot be cancelled');
});
test('skills, provenance and receipts are checked without failing the task',async t=>{
 const {server}=await hub(t),web=await browser(server);
 await assert.rejects(web.request({...lookup,recipient:'desktop'}),/a2a_skill/);
 await assert.rejects(web.request(lookup),/a2a_scope/,'The browser cannot send itself a task');
 await assert.rejects(server.tasks.request({...lookup,skill:'run-command'}),/a2a_skill/);
 await assert.rejects(server.tasks.request({...lookup,urls:['file:///etc/passwd']}),/a2a_task_invalid/);
 const sent=await server.tasks.request(lookup,{messageId:'desktop-request-1'});
 assert.equal((await server.tasks.request(lookup,{messageId:'desktop-request-1'})).id,sent.id,'A retried request returns the first task');
 await assert.rejects(server.tasks.request({...lookup,request:'다른 요청'},{messageId:'desktop-request-1'}),/collision/);
 await web.accept(sent.id,{messageId:'browser-accept-1'});assert.equal((await web.accept(sent.id,{messageId:'browser-accept-1'})).state,'working','A retried accept is answered from its receipt');
 await assert.rejects(web.accept(sent.id),/a2a_state/);
 const unsourced=found('run-2');unsourced.facts[1]={name:'날짜',value:'2026-09-30'};
 await assert.rejects(web.complete(sent.id,unsourced),/a2a_result_invalid/);
 await assert.rejects(web.complete(sent.id,{...found('run-2'),facts:[{...found('run-2').facts[0],evidenceId:'missing'}]}),/a2a_result_invalid/);
 assert.equal((await web.get(sent.id)).state,'working');
 assert.throws(()=>checkTaskResult({...found('run'),verification:'passed'}),/a2a_result_invalid/);assert.equal(checkTaskResult({...found('run'),extra:'x'}).extra,undefined);
});
test('requester cancellation and recipient rejection end the task',async t=>{
 const {server,events}=await hub(t),web=await browser(server);
 const first=await server.tasks.request(lookup),second=await server.tasks.request({...lookup,skill:'web-page-check'});
 assert.equal((await web.reject(first.id,'로그인이 필요한 사이트라 지금은 할 수 없습니다.')).state,'rejected');
 assert.equal((await server.tasks.get(first.id)).note,'로그인이 필요한 사이트라 지금은 할 수 없습니다.');
 await web.accept(second.id);assert.equal((await server.tasks.cancel(second.id)).state,'canceled');
 await assert.rejects(web.complete(second.id,found('late')),/a2a_cancelled/);await assert.rejects(web.fail(second.id,'늦은 실패'),/a2a_cancelled/);
 await settle();assert.deepEqual(events.map(event=>event.event),['created','created','rejected','accepted','canceled']);
});
test('Office pairing cannot reach task exchange',async t=>{
 const {server}=await hub(t),office=await connectA2A(server.invite('office').url,'office');
 await assert.rejects(taskApi(office),/a2a_expired/);
 const response=await fetch(server.origin+'/tasks/a2a',{method:'POST',headers:{Authorization:'Bearer '+office.token,'Content-Type':'application/json','A2A-Version':'1.0'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ListTasks',params:{}})});
 assert.equal((await response.json()).error.message,'a2a_scope');
});
test('preferred ports, restart pairing, proof-based hub lookup and revocation',async t=>{
 const store=records(),busy=createServer(),taken=await listen(busy),open=await freePort();t.after(()=>busy.close());
 const first=await createCollaborationServer({records:store,ports:[taken,open]});assert.equal(first.port,open,'An occupied preferred port is skipped');
 const connection=await connectA2A(first.invite('browser').url,'browser'),sent=await first.tasks.request(lookup);await first.close();
 assert(![...store.map.values()].some(value=>JSON.stringify(value).includes(connection.token)),'Only a hash of the token is stored');
 const next=await createCollaborationServer({records:store});t.after(()=>next.close());
 const moved=await locateHub(connection,{ports:[await freePort(),next.port]});assert.equal(moved.origin,next.origin);
 assert.equal((await (await taskApi(moved)).get(sent.id)).state,'submitted','Pairing and tasks survive the restart');
 await assert.rejects(locateHub({...connection,token:'x'.repeat(43)},{ports:[next.port]}),/a2a_unavailable/);
 const relay=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const answer=await fetch(next.origin+'/hello',{method:'POST',headers:{'Content-Type':'application/json'},body:Buffer.concat(chunks)});res.writeHead(200,{'Content-Type':'application/json'});res.end(await answer.text());});
 const relayPort=await listen(relay);t.after(()=>relay.close());
 await assert.rejects(locateHub({...connection,origin:'http://127.0.0.1:'+relayPort},{ports:[]}),/a2a_unavailable/,'A relayed proof names the real port');
 await disconnectA2A(moved);await assert.rejects(taskApi(moved),/a2a_expired/);
 await next.close();const last=await createCollaborationServer({records:store});t.after(()=>last.close());
 await assert.rejects(taskApi({...moved,origin:last.origin}),/a2a_expired/,'Disconnection survives a restart');
});
