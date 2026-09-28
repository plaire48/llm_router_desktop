// Release integration: real UI, provider adapter, Pi and C# engine. Office COM,
// SSO and model decisions are fixtures; this does not score model accuracy.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {createProviders} from '../worker/providers.mjs';
import {createWorker} from '../dist/worker/main.mjs';
import {contract,valueCheck,verdict} from './harness-fixtures.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const host=spawn(process.env.NUBI_DOTNET||'dotnet',['native/Nubi.Office.Tests/bin/Release/net8.0/Nubi.Office.Tests.dll','--rpc'],{stdio:['pipe','pipe','inherit']});
const pending=new Map();let serial=0;
const fail=()=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('Native fixture disconnected'));}pending.clear();};
host.on('error',fail);host.on('exit',fail);
createInterface({input:host.stdout}).on('line',line=>{const msg=JSON.parse(line),entry=pending.get(msg.id);if(!entry)return;pending.delete(msg.id);clearTimeout(entry.timer);msg.ok?entry.resolve(msg.result):entry.reject(new Error(msg.error));});
const native=(method,payload={})=>new Promise((resolve,reject)=>{const id=String(++serial),timer=setTimeout(()=>{pending.delete(id);reject(new Error('Native fixture timed out'));},10000);pending.set(id,{resolve,reject,timer});host.stdin.write(JSON.stringify({id,method,payload})+'\n');});
const pythonEnabled=process.platform==='win32';
let pythonResultVerified=false;
let modelCalls=0,slow=false,actor=0,latest,plans=0,approvalClicks=0,readbacks=0,repairSeen=false;
const token='eyJhbGciOiJSUzI1NiJ9.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+300})).toString('base64url')+'.fixture';
const fetchImpl=async(_url,options)=>{
  const {messages}=JSON.parse(options.body),system=messages[0].content;modelCalls++;await pause(slow?1200:40);
  let content;
  if(system.startsWith('NUBI_INTENT_ROUTER')){actor=0;content=JSON.stringify({mode:'edit'});}
  else if(system.startsWith('NUBI_TASK_PLANNER'))content=JSON.stringify(contract([valueCheck(42),{address:'A1',field:'bold',operator:'equals',expected:true}],{steps:[{id:'inspect',title:'기존 셀 확인',kind:'inspect',checkIndexes:[]},{id:'value',title:'값 반영',kind:'edit',checkIndexes:[0]},{id:'style',title:'서식 반영',kind:'edit',checkIndexes:[1]},{id:'verify',title:'결과 확인',kind:'verify',checkIndexes:[0,1]}]}));
  else if(system.startsWith('NUBI_RECOVERY_PLANNER')){repairSeen=true;const payload=JSON.parse(messages[1].content);assert.equal(payload.observation.values[0][0],42);content=JSON.stringify({decision:'revise',summary:'잘못된 서식 입력을 수정합니다.',nextAction:'이미 반영된 값은 유지하고 굵게 입력만 수정합니다.',question:''});}
  else if(system.startsWith('NUBI_'))content=verdict(JSON.parse(messages[1].content)).content;
  else {
    const steps=[['read_selection',{}],...(pythonEnabled?[['read',{path:'skills/excel-2016/SKILL.md'}],['prepare_python',{requirementsPath:'skills/excel-2016/references/python-requirements.json'}],['run_script',{path:'skills/excel-2016/scripts/report.py',input:JSON.stringify({title:'수능',rows:[{amount:12},{amount:30}]})}]]:[]),['apply_changes',{plan:JSON.stringify({operations:[{type:'set_values',address:'A1',values:[[42]]}]})}],['apply_changes',{plan:JSON.stringify({operations:[{type:'format_range',address:'A1',bold:'yes'}]})}],['apply_changes',{plan:JSON.stringify({operations:[{type:'format_range',address:'A1',bold:true}]})}],['verify_selection',{}]];
    const step=steps[actor++];if(pythonEnabled&&actor===5){const result=JSON.parse(messages.filter(m=>m.role==='tool').at(-1).content);assert.equal(result.engine,'local-cpython');assert.equal(result.output.total,42);pythonResultVerified=true;}if(step)return Response.json({choices:[{message:{content:null,tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name:step[0],arguments:JSON.stringify(step[1])}}]},finish_reason:'tool_calls'}]});
    content='A1을 42로 바꾸고 굵게 표시했습니다.';
  }
  return Response.json({choices:[{message:{content},finish_reason:'stop'}]});
};
const providers=createProviders({fetchImpl,startLogin:async()=>({result:Promise.resolve({token,models:[{id:'fixture-qwen',label:'Qwen fixture'}]}),cancel(){}})}),worker=createWorker(providers);
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=resolve('dist/web','.'+(path==='/'?'/taskpane.html':path));if(!file.startsWith(resolve('dist/web')+sep))throw new Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));await mkdir('verification',{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})}),page=await browser.newPage({viewport:{width:380,height:850}}),errors=[];
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
const approvals=new Set();let callbackError;
try{
  await page.exposeFunction('__officeCall',async({method,payload})=>{
    if(method==='toolResult'&&payload.result?.displayed){plans++;assert.equal(await page.locator('#task-panel').isVisible(),true);}
    if(method==='apply'){assert.ok(plans>0);assert.ok(approvalClicks>0);}
    if(method==='read')readbacks++;
    const result=await (['selection','read','apply','restore','history','focus'].includes(method)?native(method,payload):worker.dispatch(method,payload));
    if(method==='runStatus'){
      latest=result;
      if(result.action?.name==='request_approval'&&!approvals.has(result.action.callId)){
        approvals.add(result.action.callId);
        void (async()=>{await page.getByRole('region',{name:'반영 전 확인',exact:true}).waitFor();approvalClicks++;const kind=result.action.payload.kind;await page.getByRole('button',{name:kind==='python_install'?'환경 준비 허용':kind==='python_execute'?'코드 실행 허용':'확인 후 적용',exact:true}).click();})().catch(e=>{callbackError=e;});
      }
    }
    return result;
  });
  await page.addInitScript(()=>{const handlers=[];window.chrome={webview:{addEventListener:(_t,fn)=>handlers.push(fn),postMessage:async req=>{let reply;try{reply={id:req.id,ok:true,result:await window.__officeCall(req)};}catch(e){reply={id:req.id,ok:false,error:e.message.replace(/^.*?:\s*/,'')};}handlers.forEach(fn=>fn({data:reply}));}}};});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('.provider-button').first().waitFor();
  assert.deepEqual(await page.locator('.provider-button').allTextContents(),['AI Pro','ChatGPT','FabriX']);
  await page.getByRole('button',{name:'AI Pro',exact:true}).click();await page.locator('#request').waitFor();
  for(const width of [320,380,600,1100]){await page.setViewportSize({width,height:850});await page.evaluate(()=>document.fonts.ready);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.setViewportSize({width:380,height:850});
  await page.getByRole('button',{name:'더 보기',exact:true}).click();await page.getByRole('button',{name:'선택한 셀 확인',exact:true}).click();
  await page.getByLabel('확인할 셀',{exact:true}).selectOption('3');assert.match(await page.getByRole('dialog').textContent(),/=SUM\(A1:B1\)/);await page.keyboard.press('Escape');
  await page.locator('#request').fill('A1을 42로 바꾸고 굵게 해줘');await page.getByRole('button',{name:'전송',exact:true}).click();
  await page.locator('.message.assistant[data-state="done"]').waitFor({timeout:180000});
  if(callbackError)throw callbackError;
  assert.equal(latest.state,'done');if(pythonEnabled)assert.equal(pythonResultVerified,true);assert.equal(latest.writes,2);assert.ok(repairSeen);assert.ok(readbacks>0);assert.equal(await page.locator('#plan-progress').textContent(),'4/4 완료');
  assert.equal(await page.locator('#activity-now-label').textContent(),'작업 완료');assert.equal(await page.locator('#activity-feed [data-state="running"]').count(),0);
  const state=await native('selection');assert.equal(state.values[0][0],42);assert.equal(state.formats.bold[0][0],true);assert.equal((await native('history')).length,2);
  await page.screenshot({path:'verification/release-complete-380.png'});
  await page.getByRole('button',{name:'더 보기',exact:true}).click();await page.getByRole('button',{name:'변경 기록',exact:true}).click();
  await page.getByRole('button',{name:'이 작업 되돌리기',exact:true}).first().click();await page.getByRole('button',{name:'복원 완료',exact:true}).waitFor();
  await page.getByRole('button',{name:'이 작업 되돌리기',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-restored="true"]').length===2);
  assert.equal((await native('selection')).values[0][0],1);assert.equal((await native('selection')).formats.bold[0][0],false);await page.keyboard.press('Escape');
  slow=true;await page.getByRole('button',{name:'대화 이력',exact:true}).click();await page.getByRole('button',{name:'새 대화',exact:true}).click();await page.locator('#request').fill('A1을 42로 바꿔줘');await page.getByRole('button',{name:'전송',exact:true}).click();await page.getByRole('button',{name:'중지',exact:true}).click();
  await page.locator('.message.assistant[data-state="cancelled"]').waitFor();await pause(1500);assert.equal((await native('history')).length,2);assert.equal(await page.locator('#activity-feed [data-state="running"]').count(),0);
  assert.deepEqual(errors,[]);
  await writeFile('verification/release-browser.json',JSON.stringify({checkedAt:new Date().toISOString(),real:['React UI','AI Pro response adapter','Pi executor','C# WorkbookEngine'],fixtures:['SSO','model decisions','Excel COM'],checks:{pythonSkill:pythonResultVerified,visibleProviders:3,responsiveWidths:[320,380,600,1100],selectedFormula:true,automaticRouting:true,planBeforeWrite:plans>0,explicitApprovalClicks:approvalClicks,verifiedWrites:2,invalidFormatRepair:repairSeen,readbacks,restored:true,cancellationPreservesWork:true},modelCalls,errors},null,2)+'\n');
  console.log('PASS: current Office UI, three visible providers, automatic routing, explicit approval, sequential repair/readback, restore and cancellation. Office COM and models are fixtures.');
} catch(error){await page.screenshot({path:'verification/release-browser-failure.png'}).catch(()=>{});console.error({latest,callbackError:callbackError?.message,errors});throw error;}
finally{worker.dispose();await browser.close();server.close();host.stdin.end();host.kill();fail();}
