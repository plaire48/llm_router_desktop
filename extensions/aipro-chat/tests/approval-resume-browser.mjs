// Real extension, native file input/downloads, fixed synthetic model. No real account.
import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {mkdtemp,cp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {resolve} from 'node:path';import {createHash} from 'node:crypto';
import {startBrowserFixtures,trainingText} from '../evaluation/browser-fixtures.mjs';
import {planCompletion,fixturePlan} from './fixtures/task-plan.mjs';import {goalReviewPayload,reviewCompletion} from './fixtures/goal-review.mjs';import {completionIntentResponse} from './fixtures/completion-intent.mjs';
const server=await startBrowserFixtures(),profile=await mkdtemp(resolve(tmpdir(),'nubi-transfer-proof-')),extension=resolve(profile,'extension'),downloads=resolve(profile,'downloads');
let premature=0,selectedReadbacks=0;let context,mode='download',step=0,latest,transferId,downloadRef,approvalSeen=false;const checks=[];let routeError;
const response=(name,args={})=>({choices:[{message:name?{content:'',tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{content:mode==='download'?'training.txt 다운로드가 완료됐습니다. 파일 내용의 무결성은 검증하지 않았습니다.':'training.txt (60 bytes)를 선택했습니다. 서버 등록은 하지 않았습니다.'},finish_reason:name?'tool_calls':'stop'}]});
try {
 await cp(process.env.NUBI_EXTENSION_DIR || 'dist',extension,{recursive:true});const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('http://*/*','https://*/*');manifest.permissions.push('downloads');manifest.optional_permissions=manifest.optional_permissions.filter(x=>x!=='downloads');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
 await mkdir(downloads);await mkdir(resolve(profile,'Default'));await writeFile(resolve(profile,'Default/Preferences'),JSON.stringify({download:{default_directory:downloads,prompt_for_download:false}}));
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const cdp=await context.browser().newBrowserCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});await cdp.detach();
 await context.route('https://aipro.sdsdev.co.kr/**',async route=>{try{
  if(route.request().url().endsWith('/api/models'))return route.fulfill({json:{modelList:[{name:'GLM-5.2-NVFP4',context_length:524288}]}});
  const body=route.request().postDataJSON(),planning=planCompletion(body),review=goalReviewPayload(body.messages),intent=completionIntentResponse(body);
  if(planning||intent||review)return route.fulfill({json:planning||intent||reviewCompletion(review)});
  const tool=body.messages.findLast(m=>m.role==='tool');latest=tool?JSON.parse(tool.content):null;
  const approved=body.messages.findLast(message=>message.role==='user'&&message.content?.startsWith('The user chose the final-action approval button.'));
  if(approved&&!approvalSeen){latest=JSON.parse(approved.content.slice(approved.content.indexOf('Untrusted result data: ')+23));approvalSeen=true;}
  let data;
  if(mode==='download'){
   const live=latest?.observation||latest;if(live?.frames)downloadRef=live.frames.flatMap(f=>f.elements||[]).find(e=>e.download)?.ref || downloadRef;
   if(latest?.transfer?.transfer_id){transferId=latest.transfer.transfer_id;data=response('download_status',{transfer_id:transferId});}
   else if(latest?.transfer_id)data=latest.state==='complete'?response():response('download_status',{transfer_id:transferId});
   else if(step++===0)data=response('browser_snapshot');
   else if(step===2){downloadRef=latest.frames.flatMap(f=>f.elements||[]).find(e=>e.download).ref;data=response('verify_page',{checks:[{kind:'url_is',expected:server.origin+'/H-08'}]});}
   else if(step===3)data=response('select_tools',{groups:['files']});
   else data=response('prepare_download',{ref:downloadRef});
  }else{
   if(latest?.transfer?.kind==='upload'){step=6;data=response('update_plan',{steps:fixturePlan.map(s=>({...s,status:'completed'}))});}
   else if(step===6){step=7;premature++;data=response();}
   else if(step===7){step=8;data=response('list_upload_targets');}
   else if(step===8){selectedReadbacks++;assert.deepEqual(latest.targets[0].selectedFiles.map(f=>({name:f.name,bytes:f.bytes})),[{name:'training.txt',bytes:60}]);step=9;data=response('verify_page',{checks:[{kind:'text_present',expected:'training.txt / 60 bytes'}]});}
   else if(step===9)data=response();
   else if(step++===0)data=response('browser_snapshot');
   else if(step===2)data=response('select_tools',{groups:['files']});
   else if(step===3)data=response('list_upload_files');
   else if(step===4){if(!latest.files?.length)console.log('FILES_DIAGNOSTIC',latest,body.messages.filter(m=>m.role==='user').map(m=>({attachments:m.attachments,length:m.content?.length})));globalThis.fixtureFileId=latest.files[0].id;data=response('list_upload_targets');}
   else data=response('prepare_file_upload',{ref:latest.targets[0].ref,file_ids:[globalThis.fixtureFileId]});
  }
  return route.fulfill({json:data});
 }catch(e){routeError=e;await route.abort();}});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),page=await context.newPage();await page.goto(server.origin+'/H-08');
 const token=`header.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.signature`;
 await worker.evaluate(token=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token,receivedAt:1}}),token);await worker.evaluate(()=>chrome.storage.local.set({browserWorkMode:'current'}));
 const ui=await context.newPage();await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
 const rpc=async message=>(await ui.evaluate(message=>chrome.runtime.sendMessage(message),message)).data;
 for(let i=0;i<50;i++){if((await rpc({type:'GET_STATE'})).catalog?.models?.length)break;await ui.waitForTimeout(100);}
 const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,page.url()),uiId=await ui.evaluate(async()=>(await chrome.tabs.getCurrent()).id);await worker.evaluate(({uiId,tabId})=>chrome.storage.session.set({chatSourceTabs:{[uiId]:tabId}}),{uiId,tabId});
 async function finish(){for(let i=0;i<600;i++){if(routeError)throw routeError;const s=await rpc({type:'GET_STATE'}),q=s.chat.messages.at(-1)?.question;if(q?.kind==='approval'&&!q.answer)await ui.getByRole('button',{name:q.options.find(option=>option.id==='approve').label,exact:true}).click();if(!s.busy&&(s.chat.messages.at(-1)?.state==='done'||s.chat.messages.at(-1)?.error)&&!q)return s;await ui.waitForTimeout(50);}const diagnostic=await rpc({type:'GET_STATE'});console.log('DIAGNOSTIC',JSON.stringify({busy:diagnostic.busy,error:diagnostic.chat.messages.at(-1)?.error,verification:diagnostic.chat.task?.verification}));throw Error('native_transfer_not_completed');}
 await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('교육 안내 파일을 다운로드하고 파일명과 완료 상태를 확인해주세요.');await ui.getByRole('button',{name:'전송',exact:true}).click();let s=await finish();assert.equal(s.chat.messages.at(-1).error,null);assert.equal(s.chat.task.verification.source,'chrome_download_completion');
 const file=await worker.evaluate(async()=> (await chrome.downloads.search({})).find(item=>item.state==='complete'));assert(file);assert(file.filename.startsWith(downloads));const bytes=await readFile(file.filename);assert.equal(createHash('sha256').update(bytes).digest('hex'),createHash('sha256').update(trainingText).digest('hex'));checks.push('Chrome completion closes only its own native transfer; independently downloaded bytes match');
 await rpc({type:'NEW_CHAT'});await ui.reload();await page.goto(server.origin+'/H-09');await page.evaluate(()=>{window.fileSelections=0;document.querySelector('input[type=file]').addEventListener('change',()=>window.fileSelections++);});mode='upload';step=0;approvalSeen=false;
 await ui.getByLabel('첨부 파일 선택',{exact:true}).setInputFiles({name:'training.txt',mimeType:'text/plain',buffer:Buffer.from(trainingText)});
 for(let i=0;i<50;i++){if((await rpc({type:'GET_STATE'})).chat.draftAttachments?.length)break;await ui.waitForTimeout(50);}
 assert.equal((await rpc({type:'GET_STATE'})).chat.draftAttachments.length,1);await ui.waitForTimeout(300);
 await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('첨부한 training.txt를 자료 파일에 선택하고 파일명과 크기를 확인해주세요. 서버 등록은 하지 마세요.');await ui.getByRole('button',{name:'전송',exact:true}).click();s=await finish();assert.equal(s.chat.messages.at(-1).error,null);
 assert.deepEqual(await page.evaluate(async()=>({name:document.querySelector('input[type=file]').files[0].name,bytes:document.querySelector('input[type=file]').files[0].size,content:await document.querySelector('input[type=file]').files[0].text(),submits:window.evalCounters.submits,selections:window.fileSelections})),{name:'training.txt',bytes:60,content:trainingText,submits:0,selections:1});assert.equal(premature,1);assert.equal(selectedReadbacks,1);assert.equal(s.chat.task.verification.status,'passed');checks.push('Premature model answer was held until fresh verification, without replaying approval. Fresh selectedFiles readback matches actual FileList name/size/content, with server submission zero');
 const output=process.env.NUBI_VERIFICATION_DIR || 'verification/approval-resume-browser';await mkdir(output,{recursive:true});await writeFile(resolve(output,'chrome.json'),JSON.stringify({scope:'actual-Chrome-and-files-synthetic-model',checks},null,2));console.log(JSON.stringify({checks}));
}finally{await context?.close();await server.close();await rm(profile,{recursive:true,force:true});}
