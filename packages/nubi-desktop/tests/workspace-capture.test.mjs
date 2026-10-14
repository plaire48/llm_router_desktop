import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {installWorkspaceBrowser} from '../runtime/workspace-browser.mjs';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);

// The agent's screenshot tool (user request 2026-10-14): the worker asks the host for one PNG of the Workspace browser
// tab, sends it to the image-capable model and returns the model's description to the run.
const PNG=Buffer.from('89504e470d0a1a0a0000000d49484452','hex').toString('base64');

test('the capture bridge resolves the host reply and reports host errors by code',async()=>{
  const sent=[],originalSend=process.send;
  process.send=(message,callback)=>{sent.push(message);callback?.(null);return true;};
  try{
    const service={};installWorkspaceBrowser(service);
    const reply=service.captureWorkspacePage();
    const id=sent.at(-1).workspaceCaptureRequest.id;
    process.emit('message',{workspaceCaptureReply:{id,image:PNG,width:800,height:600,url:'http://localhost:3000/',title:'앱'}});
    assert.deepEqual(await reply,{image:PNG,width:800,height:600,url:'http://localhost:3000/',title:'앱'});
    const failing=service.captureWorkspacePage();
    process.emit('message',{workspaceCaptureReply:{id:sent.at(-1).workspaceCaptureRequest.id,error:'browser_capture_limit'}});
    await assert.rejects(failing,/browser_capture_limit/);
  }finally{process.send=originalSend;}
});

test('inspect_workspace_page sends the capture to the image model and returns its analysis to the run',async t=>{
  const {service}=await fixture(t);
  service.openWorkspacePage=async()=>({opened:true,userInteractionRequired:true});
  service.captureWorkspacePage=async()=>({image:PNG,width:800,height:600,url:'http://localhost:3000/',title:'정적 서버'});
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  let round=0,imageCall=null,toolResult=null;
  service.providers={status:()=>({connected:true,provider:'chatgpt',model:'fixture',models:[{id:'fixture',supportsImages:true,contextLength:32000,maxOutputTokens:4096}]}),dispose(){},
    async complete(messages,definitions){
      if(messages.some(message=>Array.isArray(message.content)&&message.content.some(part=>part.type==='image_url'))){imageCall={messages};return {content:'로그인 폼과 "정적 서버" 제목이 보입니다. 오류 표시는 없습니다.',calls:[]};}
      round++;
      if(round===1){assert.ok(definitions.some(item=>item.function.name==='inspect_workspace_page'),'the screenshot tool is offered');return call('inspect_workspace_page',{question:'화면에 오류가 있나요?'});}
      const toolMessage=messages.filter(message=>message.role==='tool').at(-1);if(toolMessage){try{toolResult=JSON.parse(typeof toolMessage.content==='string'?toolMessage.content:JSON.stringify(toolMessage.content));}catch{toolResult={raw:toolMessage.content};}}
      if(!toolMessage)console.log('ROLES',messages.map(message=>message.role+':'+String(typeof message.content==='string'?message.content:JSON.stringify(message.content)).slice(0,80)).join(' | '));
      return {content:'화면을 확인했습니다. 오류는 없습니다.',calls:[]};
    }};
  const task=await service.createTask({request:'서버 화면을 보고 오류가 있는지 알려줘'});
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.ok(imageCall,'the capture went to a model');
  const user=imageCall.messages.find(message=>message.role==='user');
  assert.match(user.content.find(part=>part.type==='image_url').image_url.url,/^data:image\/png;base64,/);
  assert.match(user.content.find(part=>part.type==='text').text,/localhost:3000/);
  assert.equal(toolResult.ok,true);assert.equal(toolResult.model,'fixture');assert.match(toolResult.analysis,/로그인 폼/);
  assert.match(service.task(task.id).messages.at(-1).content,/오류는 없습니다/);
});
