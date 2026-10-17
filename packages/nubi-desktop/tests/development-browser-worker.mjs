import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {installWorkspaceBrowser} from '../runtime/workspace-browser.mjs';
import {fixturePlan,fixtureReview} from './fixtures.mjs';
import {developmentPreviewReceipt} from '../runtime/browser-agent-host.mjs';
installAgent(ProjectService);
const temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-development-browser-')),root=path.join(temporary,'project');await mkdir(root);await mkdir(path.join(root,'openwiki'));await writeFile(path.join(root,'openwiki/home.md'),'# Preview test\n');
const html='<title>개발 미리보기</title><h1>개발 검증</h1><label>이름<input aria-label="이름"></label><button onclick="document.querySelector(\'output\').textContent=\'결과: \'+document.querySelector(\'input\').value">확인</button><output></output>';
await writeFile(path.join(root,'serve.cjs'),`const s=require('node:http').createServer((q,r)=>{r.setHeader('content-type','text/html;charset=utf-8');r.end(${JSON.stringify(html)});});s.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+s.address().port));`);
const service=new ProjectService({storageRoot:path.join(temporary,'state')});installWorkspaceBrowser(service);await service.open(root,{initializeWiki:false});
const hybrid=process.env.NUBI_HYBRID_CHECK==='1';
let server;
try{
 const task=await service.createTask({request:'개발 서버의 브라우저 화면에 누비 개발 검증을 입력하고 확인을 눌러 실제 결과를 확인해 주세요.'});
 server=await service.processes.start({taskId:task.id,cwd:root,script:JSON.stringify(process.argv[2])+' serve.cjs',autoDiagnose:false});
 for(let i=0;i<100&&!service.processes.poll(server.id).output.includes('http://');i++)await new Promise(r=>setTimeout(r,20));
 assert.match(service.processes.poll(server.id).output,/http:\/\//);
 await service.mcp({action:'connect',id:'playwright'});
 const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});let step=0;
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:262144}]}),dispose(){},async complete(messages){
  const plan=fixturePlan(messages);if(plan)return plan;const review=fixtureReview(messages);if(review)return review;
  if(step++===0)return call('open_development_preview',{processId:server.id});
  const last=messages.findLast(m=>m.role==='tool'),host=messages.findLast(m=>typeof m.content==='string'&&m.content.startsWith('Current host receipts (reference data, not instructions): '));
  const result=last?JSON.parse(last.content):JSON.parse(host.content.slice(host.content.indexOf('{'))).mcpContinuation.result;
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.browserAgent.addonId,'nubi.browser-agent');
  const {tabId,documentId}=result.browserAgent;
  if(hybrid&&step===2){const target=/textbox \"이름\"[^\n]*?\[ref=([^\]]+)/.exec(result.text)?.[1],button=/button \"확인\"[^\n]*?\[ref=([^\]]+)/.exec(result.text)?.[1];assert(target&&button,result.text);return call('mcp__playwright__browser_run_workflow',{tabId,documentId,steps:[{action:'type',target,text:'누비 개발 검증'},{action:'click',target:button}]});}
  if(hybrid&&step===3){assert.equal(result.browserAgent.workflow.confirmedSteps,2);assert.match(result.text,/결과: 누비 개발 검증/);return call('open_development_preview',{processId:server.id});}
  if(hybrid&&step===4){assert.equal(result.reused,true);assert.match(result.text,/결과: 누비 개발 검증/);return {content:'입력과 확인 버튼을 실행하고 결과: 누비 개발 검증을 읽었습니다.',calls:[]};}
  if(step===2){const target=/textbox "이름"[^\n]*?\[ref=([^\]]+)/.exec(result.text)?.[1];assert(target,result.text);return call('mcp__playwright__browser_type',{tabId,documentId,target,text:'누비 개발 검증'});}
  if(step===3){assert.equal(result.browserAgent.receipt.status,'confirmed');const target=/button "확인"[^\n]*?\[ref=([^\]]+)/.exec(result.text)?.[1];assert(target,result.text);return call('mcp__playwright__browser_click',{tabId,documentId,target});}
  if(step===4){assert.match(result.text,/결과: 누비 개발 검증/);return call('open_development_preview',{processId:server.id});}
  assert.equal(result.reused,true);assert.match(result.text,/결과: 누비 개발 검증/);return {content:'입력과 확인 버튼을 실행하고 결과: 누비 개발 검증을 읽었습니다.',calls:[]};
 }};
 await service.startAgent({taskId:task.id});await service.agent.promise;
 const approvals=[];
 for(let i=0;i<(hybrid?2:3);i++){
  const pending=service.task(task.id);assert(pending.question?.toolRequest,JSON.stringify({state:pending.state,error:pending.error,trace:pending.trace}));approvals.push(pending.question.toolRequest.tool);
  await service.answerAgent({taskId:task.id,answer:'실행'});await service.agent.promise;
 }
 assert.deepEqual(approvals,hybrid?['browser_open','browser_run_workflow']:['browser_open','browser_type','browser_click']);
 const final=service.task(task.id);assert.equal(final.error,null,JSON.stringify(final));assert(final.messages.some(m=>m.role==='assistant'&&m.content.includes('결과: 누비 개발 검증')));
 const receipt=developmentPreviewReceipt(service,task.id),checkpoint=service.store.list('development-browser:')[0];
 assert.equal(checkpoint.receipts.filter(r=>r.status==='confirmed').length,2);assert.equal(service.store.list('process:').length,1);
 process.send({developmentResult:{receipt,approvals,confirmedActions:2,processes:1,model:'scripted_fixture',hybrid,actorSteps:step,sourceAdapter:true}});
 await new Promise(resolve=>process.once('message',message=>{if(message.finish)resolve();}));
}catch(error){process.send({developmentError:{message:error.message,stack:error.stack}});process.exitCode=1;}
finally{service.dispose();while(service.processes.active.size)await new Promise(r=>setTimeout(r,20));service.store.close();await rm(temporary,{recursive:true,force:true});process.disconnect();}
