// An agent run in the real Electron app with a scripted model (2026-10-07): a requested change becomes a proposal the
// user applies from the conversation, the file and the Git view show it and the run verifies it; a model server that
// fails leaves a readable message and the run resumes once it is back. No real provider, login or network.
// Run from the package dir after scripts/build-electron.mjs: node scripts/check-electron-agent.mjs
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {startFixtureModel} from './fixture-model.mjs';
const require=createRequire(import.meta.url);
const temporary=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-agent-check-'))),root=path.join(temporary,'project'),storage=path.join(temporary,'state');
await mkdir(root);await mkdir(storage);
// This checks chat execution, not repository Wiki generation. Keep its source
// fixture initialized so a separate initialization modal cannot intercept Send.
await mkdir(path.join(root,'openwiki'));await writeFile(path.join(root,'openwiki/home.md'),'# Fixture\n\nexample.js contains the value under test.\n');
const git=args=>execFileSync('git',['-C',root,...args]);git(['init']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);
await writeFile(path.join(root,'large.md'),'A'.repeat(168000));
await writeFile(path.join(root,'example.js'),'export const value = 1;\n');git(['add','.']);git(['commit','-m','Initial fixture']);
await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));

// The scenario moves through phases the check sets: edit (read, plan, propose, hand over), verify (after the user
// applied the proposal), and answer (after the server was down).
const scenario={phase:'edit'};
const fixture=await startFixtureModel({respond({messages,results,user,calls,text,call}){
  if(scenario.phase==='documents'){
    const prompt=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
    const report=ids=>({status:'complete',answer:'읽은 범위를 확인했습니다.',findings:ids.length?[{text:'원문 근거',citations:ids.slice(0,3)}]:[],uncertainties:[]});
    if(prompt.includes('Plan OpenWiki research'))return text(JSON.stringify({mode:'comprehensive',questions:['전체 확인']}));
    if(prompt.includes('Synthesize'))return text(JSON.stringify(report(JSON.parse(messages.at(-1).content).evidence.map(item=>item.id))));
    let assignment;try{assignment=JSON.parse(messages.find(m=>m.role==='user').content).assignment;}catch{}
    if(assignment){
      const reads=results.filter(r=>r.id&&Number.isInteger(r.end)),start=reads.at(-1)?.end??assignment.range.start;
      if(reads.length&&start>=assignment.range.end)return text(JSON.stringify(report(reads.map(r=>r.id))));
      return call('read_wiki',{documentId:assignment.documentIds[0],start,length:Math.min(6000,assignment.range.end-start)});
    }
    if(!scenario.documentStarted){scenario.documentStarted=true;return call('analyze_documents',{paths:['large.md'],question:'문서 전체를 확인해 주세요.'});}
    scenario.documentResult=results.find(r=>r.coverage?.budgetLimitedTasks);
    return text('작업자 한도로 일부 문서 구간을 읽지 못했습니다.');
  }
  if(scenario.phase==='research'){
    if(String(messages[0]?.content).startsWith('You are a read-only research assistant.')){
      scenario.childCalls=(scenario.childCalls||0)+1;
      if(scenario.childCalls===1)return call('read_source',{path:'example.js',start:1,end:1});
      return text(JSON.stringify({summary:'value는 2입니다.',findings:[{claim:'value는 2입니다.',source:{path:'example.js',range:'1-1'}}],unresolved:[]}));
    }
    scenario.leaderCalls=(scenario.leaderCalls||0)+1;
    if(scenario.leaderCalls===1)return call('delegate_research',{goal:'example.js의 value를 확인',scope:{paths:['example.js']},budget:{calls:5,chars:24000}});
    if(scenario.leaderCalls===2){scenario.researchResult=results.find(r=>r.advisory&&r.findings?.length===1);return call('read_source',{path:'example.js',start:1,end:1});}
    return text('조사 뒤 원문을 다시 읽었습니다. value는 2입니다.');
  }
  if(scenario.phase==='edit'){
    const read=results.find(result=>result?.path==='example.js'&&typeof result.content==='string'&&result.hash);
    if(!read)return call('read_source',{path:'example.js'});
    if(!calls.includes('record_change_plan'))return call('record_change_plan',{summary:'example.js의 value를 2로 바꾼다',requirements:[{id:'R1',text:'value가 2다'}],targets:[{path:'example.js',reason:'현재 값 1을 확인했다',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'inspection',description:'example.js의 value가 2인지 본다'}],assumptions:[]});
    if(!calls.includes('propose_patch'))return call('propose_patch',{path:'example.js',expectedHash:read.hash,edits:[{oldText:'value = 1',newText:'value = 2'}],reason:'요청대로 value를 2로 바꾼다'});
    return text('example.js의 value를 2로 바꾸는 제안을 올렸어요. 반영해 주세요.');
  }
  if(scenario.phase==='verify')return text('반영을 확인했어요. value는 이제 2예요.');
  if(scenario.phase==='ask'){/* one concrete decision, then the answer the user chose is in the conversation */
    if(!scenario.asked){scenario.asked=true;return call('ask_user',{question:'어떤 값으로 바꿀까요?',choices:[{label:'둘',description:'value를 2로'},{label:'셋',description:'value를 3으로'}],input_mode:'text'});}
    return text(user.some(content=>content.includes('셋'))?'셋을 골라 주셨어요. value를 3으로 바꾸는 쪽으로 진행할게요.':'답을 받지 못했어요.');
  }
  return text('모델이 다시 연결돼 답했어요.');
}});
const checks=[];let app,page;const stage=name=>{console.log('stage',checks.length,name);checks.push(name);};
const request=(method,args={})=>page.evaluate(({method,args})=>window.nubi.request(method,args),{method,args});
const toast=text=>page.locator('.nubi-feedback-toast').filter({hasText:text});
try{
  app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
  page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>console.log('PAGE ERROR:',error.message));
  await page.getByRole('navigation',{name:'프로젝트 도구'}).waitFor({timeout:30000});
  await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor({timeout:30000});
  const startup=page.getByText('메일을 연결해 주세요');if(await startup.count()){await page.keyboard.press('Escape');await startup.waitFor({state:'hidden',timeout:5000});}
  const sidebarClose=page.getByRole('button',{name:'사이드바 접기',exact:true});if(await sidebarClose.count())await sidebarClose.click();
  const status=await request('provider',{action:'connect',input:fixture.connection});assert.equal(status.connected,true);
  const composer=page.getByRole('textbox',{name:'작업 요청'});await composer.waitFor({timeout:20000});stage('fixture model connected');
  await composer.fill('example.js의 value를 2로 바꿔 줘');await page.getByRole('button',{name:'전송',exact:true}).click();
  const card=page.locator('.nubi-results .nubi-proposal-card').filter({hasText:'example.js'});await card.waitFor({timeout:90000});
  assert.deepEqual(fixture.calls.filter(name=>!['report_desktop_review'].includes(name)),['read_source','record_change_plan','propose_patch'],'the run read, planned and proposed before handing over');
  assert.equal(await readFile(path.join(root,'example.js'),'utf8'),'export const value = 1;\n','nothing is written before the user applies');
  await page.getByText('제안을 올렸어요').first().waitFor();stage('a requested change becomes a proposal card, not a write');
  await page.waitForFunction(()=>{const records=[...document.querySelectorAll('.nubi-agent-activity .agent-trace')];return records.length>0&&records.every(record=>!record.open);});stage('progress automatically collapses when the answer arrives');
  // Copy buttons write the real clipboard from a user gesture (denied by the permission handler before 2026-10-09). The user's text clipboard is put back afterwards.
  {const saved=await app.evaluate(({clipboard})=>clipboard.readText());try{await app.evaluate(({clipboard})=>clipboard.writeText('nubi-check-placeholder'));await page.getByRole('button',{name:'내 메시지 복사',exact:true}).first().click();await page.getByRole('button',{name:'내 메시지 복사 완료',exact:true}).first().waitFor();assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'example.js의 value를 2로 바꿔 줘','the message reaches the system clipboard');assert.equal(await page.locator('.copy-error').count(),0);stage('a copy button writes the system clipboard');}finally{await app.evaluate(({clipboard},text)=>clipboard.writeText(text),saved);}}
  await card.getByRole('button',{name:'비교',exact:true}).click();await page.waitForFunction(()=>/value\s*=\s*2/.test(document.querySelector('.desktop-git-diff,.desktop-editor')?.textContent||''),null,{timeout:15000});stage('the comparison shows the proposed change');await page.getByRole('button',{name:'오른쪽 사이드바 닫기',exact:true}).click();
  scenario.phase='verify';await card.getByRole('button',{name:'반영',exact:true}).click();await toast('파일 반영을 확인했어요.').waitFor({timeout:30000});
  assert.equal(await readFile(path.join(root,'example.js'),'utf8'),'export const value = 2;\n','applying writes the proposed content');
  await page.getByText('반영을 확인했어요. value는 이제 2예요.').waitFor({timeout:90000});
  await page.getByRole('button',{name:'Git 변경',exact:true}).click();await page.locator('.desktop-list').getByRole('button',{name:'example.js'}).waitFor();stage('applying writes the file, the run verifies it and Git lists the change');await page.getByRole('button',{name:'오른쪽 사이드바 닫기',exact:true}).click();
  const sidebarOpen=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await sidebarOpen.count())await sidebarOpen.click();
  await page.waitForFunction(()=>{const sidebar=document.querySelector('.nubi-sidebar[data-open=true]'),content=document.querySelector('.nubi-workbench-content');return sidebar&&content&&sidebar.getBoundingClientRect().right<=content.getBoundingClientRect().left+1;});stage('the reopened sidebar leaves the conversation and recovery controls unobscured');
  const state=await request('state');const task=state.tasks[0];assert.ok(task,'the task exists');assert.equal(state.proposals.filter(item=>item.state==='applied').length,1,'one applied proposal');
  fixture.setFailing(true);const followUp=page.getByRole('textbox',{name:'추가 요청'});await followUp.fill('한 줄로 다시 답해 줘');await page.getByRole('button',{name:'전송',exact:true}).click();
  await toast(/분석이 멈췄어요|모델 사용량 제한/).waitFor({timeout:60000});await page.getByRole('button',{name:'이어서 진행',exact:true}).waitFor({timeout:15000});stage('a model server failure ends the run with a readable message');
  fixture.setFailing(false);scenario.phase='answer';await page.getByRole('button',{name:'이어서 진행',exact:true}).click();await page.getByText('모델이 다시 연결돼 답했어요.').waitFor({timeout:90000});stage('the run resumes once the model is back');
  scenario.phase='ask';await followUp.fill('값을 하나 더 고를게요');await page.getByRole('button',{name:'전송',exact:true}).click();
  // Questions are answered inline in the conversation (2026-10): no prompt button, no dialog.
  const question=page.getByRole('region',{name:'답변이 필요한 질문',exact:true});await question.waitFor({timeout:60000});await question.getByText('어떤 값으로 바꿀까요?').waitFor();/* the question is kept by the bell (unread dot), not by an in-app toast; the form itself is on the Windows notification (2026-10-14) */await page.locator('.nubi-rail-notice-dot').waitFor();await question.locator('.question-option').filter({hasText:'셋'}).first().click();await question.getByRole('button',{name:/답변 보내기|^보내기$/}).click();
  await page.getByText('셋을 골라 주셨어요').waitFor({timeout:90000});assert.equal(await question.count(),0,'the answered question leaves the conversation');stage('a question from the run is answered with a choice and the run continues');
  scenario.phase='research';await followUp.fill('조사 작업자로 example.js의 값을 확인하고 원문도 다시 읽어 줘');await page.getByRole('button',{name:'전송',exact:true}).click();
  await page.getByText('조사 뒤 원문을 다시 읽었습니다. value는 2입니다.',{exact:true}).waitFor({timeout:90000});
  assert.equal(scenario.childCalls,2);assert.equal(scenario.leaderCalls,3);assert.ok(scenario.researchResult,'research returns sourced advice');
  const roles=page.getByRole('region',{name:'역할별 분석 진행'}).last();await roles.waitFor();await roles.locator('summary').first().click();
  const worker=roles.locator('[data-tool="analysis_research"]');await worker.getByText('조사 1',{exact:true}).waitFor();await worker.locator('summary').click();await worker.getByText('모델 호출 2회 / 근거 읽기 1회',{exact:true}).waitFor();
  await mkdir('verification/wave2',{recursive:true});await page.screenshot({path:'verification/wave2/task9-research.png'});
  stage('research reads in its own context, leader rereads and the existing history shows 조사');
  scenario.phase='documents';await followUp.fill('large.md 전체를 확인하고 읽지 못한 범위를 알려 줘');await page.getByRole('button',{name:'전송',exact:true}).click();
  await page.getByText('작업자 한도로 일부 문서 구간을 읽지 못했습니다.',{exact:true}).waitFor({timeout:90000});
  assert.ok(scenario.documentResult);assert.equal(scenario.documentResult.status,'partial');assert.equal(scenario.documentResult.coverage.budgetLimitedTasks,1);
  const documentProgress=page.getByRole('region',{name:'문서 분석 진행'}).last();await documentProgress.getByText('읽지 못한 구간 1개가 남아 있어요.',{exact:true}).waitFor();
  await page.screenshot({path:'verification/wave2/task9-document-limit.png'});stage('large document worker limit preserves and displays unread ranges');

  await mkdir('verification',{recursive:true});await page.screenshot({path:'verification/electron-agent.png'});
  await writeFile('verification/electron-agent.json',JSON.stringify({platform:process.platform,checks,toolCalls:fixture.calls,modelRequests:fixture.requests,reviewProblems:fixture.reviewProblems,boundary:'Local Electron with a scripted loopback model and a temporary Git project. No real provider login.'},null,2));
  console.log(JSON.stringify({checks,toolCalls:fixture.calls,modelRequests:fixture.requests.length}));
}catch(error){await mkdir('verification',{recursive:true});await page?.screenshot({path:'verification/electron-agent-failure.png'}).catch(()=>{});console.log('model requests:',JSON.stringify(fixture.requests));console.log('tool calls:',JSON.stringify(fixture.calls));console.log('review problems:',JSON.stringify(fixture.reviewProblems));console.log(await page?.locator('.nubi-feedback-toast,.desktop-error,.nubi-error').allTextContents().catch(()=>[]));throw error;}
finally{await app?.close().catch(()=>{});fixture.close();await rm(temporary,{recursive:true,force:true});}
