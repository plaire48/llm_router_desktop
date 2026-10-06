import {completionIntentResponse} from './fixtures/completion-intent.mjs';
// Actual Chrome, official SDK and authenticated HTTP. Model/account are synthetic.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,cp,rm,access,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createCollaborationServer} from '../../../packages/nubi-a2a/server.mjs';
import {CONTRACT} from '../../../packages/nubi-a2a/contract.mjs';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload,reviewCompletion} from './fixtures/goal-review.mjs';
const rows=new Map(),records={get:k=>rows.get(k),set:(k,v)=>rows.set(k,structuredClone(v)),list:p=>[...rows].filter(([k])=>k.startsWith(p)).map(([,v])=>structuredClone(v))};
let current=true;
const server=await createCollaborationServer({records,validateContext:async()=>current});
const profile=await mkdtemp(resolve(tmpdir(),'nubi-a2a-enabled-')),extension=resolve(profile,'extension');
let context;const checks=[],errors=[];let modelCalls=0;
const pass=label=>{checks.push(label);console.log('PASS '+label);};
try {
 await access('dist/a2a-connection.js');await access('dist/a2a-licenses');await cp('dist',extension,{recursive:true});
 const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('http://*/*','https://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 await context.route('https://aipro.sdsdev.co.kr/**',async route=>{
  if(route.request().url().endsWith('/api/models'))return route.fulfill({json:{modelList:[{name:'GLM-5.2-NVFP4',context_length:524288}]}});
  modelCalls++;const body=route.request().postDataJSON();const intent=completionIntentResponse(body);if(intent)return route.fulfill({json:intent});const planning=planCompletion(body),review=goalReviewPayload(body.messages);
  if(planning)return route.fulfill({json:planning});if(review)return route.fulfill({json:reviewCompletion(review)});
  return route.fulfill({json:{choices:[{message:{role:'assistant',content:'AC-1: 제목과 본문을 입력하고 등록 전 확인하는 시나리오 초안입니다. 실제 사이트 테스트는 수행하지 않았습니다.'},finish_reason:'stop'}]}});
 });
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),ui=await context.newPage();ui.on('pageerror',e=>errors.push(e.message));
 const token=`header.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.signature`;
 await worker.evaluate(token=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token,receivedAt:1}}),token);
 await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
 const rpc=async message=>{const value=await ui.evaluate(message=>chrome.runtime.sendMessage(message),message);assert(value.ok,JSON.stringify(value));return value.data;};
 for(let i=0;i<50;i++){if((await rpc({type:'GET_STATE'})).catalog?.models?.length)break;await ui.waitForTimeout(100);}
 const packet={contract:CONTRACT,sourceTaskId:'source-test',digest:'sha256:'+'a'.repeat(64),recipient:'browser',request:'교육 안내 폼의 테스트 시나리오 초안을 설명해주세요. 실제 페이지 조작은 하지 마세요.',criteria:[{id:'AC-1',text:'제목과 본문 입력, 등록 전 확인'}],sources:[],wiki:[],references:[]};
 const task=await server.submit(packet,'chrome-request-1');
 await ui.setViewportSize({width:320,height:850});await ui.getByRole('button',{name:'설정',exact:true}).click();await ui.getByRole('button',{name:'누비 작업 연결',exact:true}).click();
 await ui.getByLabel('데스크톱에서 복사한 연결 주소').fill(server.invite('browser').url);
 await ui.getByRole('button',{name:'연결',exact:true}).click();await ui.getByText('데스크톱 연결됨',{exact:true}).waitFor();
 const state=await rpc({type:'GET_STATE'}),conversationId=state.chat.sessionId;
 await rpc({type:'DRAFT',value:'작성 중인 요청',provider:'aipro',conversationId});
 assert.equal((await rpc({type:'A2A',action:'import',id:task.id,conversationId})).error,'a2a_draft_exists');pass('existing draft is preserved and import refuses to replace it');
 await rpc({type:'DRAFT',value:'',provider:'aipro',conversationId});
 await ui.getByRole('button',{name:'요청 가져오기',exact:true}).click();await ui.getByRole('dialog',{name:'설정',exact:true}).waitFor();await ui.keyboard.press('Escape');
 const imported=(await rpc({type:'GET_STATE'})).chat.draft;assert.match(imported,/AC-1/);assert.equal(modelCalls,0);pass('authenticated A2A import reaches the existing composer without automatic model execution');
 assert.equal((await rpc({type:'A2A',action:'result',id:task.id,text:'forged',conversationId})).error,'a2a_no_result');
 await ui.getByRole('button',{name:'전송',exact:true}).click();
 let reply;for(let i=0;i<300;i++){const s=await rpc({type:'GET_STATE'});reply=s.chat.messages.at(-1);if(!s.busy&&reply?.state==='done')break;await ui.waitForTimeout(100);}
 if(reply?.state!=='done'||!reply.content)console.log('DIAGNOSTIC',JSON.stringify((await rpc({type:'GET_STATE'})).chat),await ui.locator('body').innerText());
 assert.equal(reply?.state,'done');assert.match(reply.content,/시나리오 초안/);assert(modelCalls>0);pass('explicit Send starts the ordinary Nubi model runner and binds its host run');
 await ui.reload();const status=await rpc({type:'A2A',action:'status'});assert.equal(status.active.canSend,true);pass('UI reload retains session-owned connection and completed run binding');
 
 const delivered=await rpc({type:'A2A',action:'result',id:task.id,text:'forged',conversationId});assert(!delivered.error,JSON.stringify(delivered));assert.equal(delivered.active,null);
 const complete=delivered.tasks.find(t=>t.id===task.id);assert.equal(complete.state,3);assert.equal(complete.result.text,reply.content);assert.equal(complete.result.localRunId,reply.id);assert.equal(complete.result.verification,'not_run');pass('current context returns only the actual host answer through the SDK');
 const staleTask=await server.submit({...packet,digest:'sha256:'+'b'.repeat(64)},'chrome-stale-request');
 await rpc({type:'NEW_CHAT'});await ui.reload();const nextConversation=(await rpc({type:'GET_STATE'})).chat.sessionId;
 const next=await rpc({type:'A2A',action:'import',id:staleTask.id,conversationId:nextConversation});
 await ui.getByRole('textbox',{name:'메시지',exact:true}).fill(next.draft);await ui.getByRole('button',{name:'전송',exact:true}).click();
 for(let i=0;i<300;i++){const state=await rpc({type:'GET_STATE'});if(!state.busy&&state.chat.messages.at(-1)?.state==='done'&&state.chat.messages.at(-1)?.content)break;await ui.waitForTimeout(100);}
 assert.equal((await rpc({type:'A2A',action:'status'})).active.canSend,true);current=false;assert.equal((await rpc({type:'A2A',action:'result',id:staleTask.id,conversationId:nextConversation})).error,'a2a_stale');pass('changed source context rejects a separately bound result without repeating the browser run');
 const publicState=JSON.stringify(await rpc({type:'GET_STATE'}));const session=await worker.evaluate(()=>chrome.storage.session.get('a2a'));assert(!publicState.includes(session.a2a.connection.token));assert(!imported.includes(session.a2a.connection.token));
 await rpc({type:'A2A',action:'disconnect'});assert.equal((await rpc({type:'A2A',action:'status'})).connected,false);assert.deepEqual(errors,[]);pass('authentication stays out of public state/model context and explicit disconnect revokes the connection');
 await mkdir('verification/a2a-2026-10-01',{recursive:true});await writeFile('verification/a2a-2026-10-01/chrome.json',JSON.stringify({scope:'actual-Chrome-and-A2A-HTTP-synthetic-model',checks,modelCalls,errors},null,2));
}finally{await context?.close();await server.close();await rm(profile,{recursive:true,force:true});}
