// Chat form fill check (document forms Task K, 2026-10-21): the user asks in the chat to write a report with a Word
// form; the agent must use fill_document_form, ask the one missing value in the chat (no form card), and write a copy
// after the answer. Synthetic form and request only; the model is the one the user is logged in to.
//
// Usage: node eval/document-forms/chat-run.mjs --out <dir> [--model claude-sonnet-5-5]
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const option=name=>{const at=process.argv.indexOf('--'+name);return at>0?process.argv[at+1]:undefined;};
const out=option('out')&&path.resolve(option('out')),model=option('model')||'claude-sonnet-5-5';
if(!out){console.error('사용법: node eval/document-forms/chat-run.mjs --out <dir>');process.exit(2);}
await mkdir(out,{recursive:true});
const {ProjectService}=await import('../../runtime/project-service.mjs');
const {installAgent}=await import('../../runtime/agent.mjs');if(!ProjectService.prototype.startAgent)installAgent(ProjectService);
const {createDesktopProviders}=await import('../../runtime/desktop-providers.mjs');
const {git}=await import('../../runtime/files.mjs');
const {docxSnapshot}=await import('../../runtime/docx-snapshot.mjs');
const {docxFromBlocks,FORMS}=await import('../../tests/helpers-docx-fixture.mjs');
const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-form-chat-'))),root=path.join(dir,'repo');
let original;const report={model,startedAt:new Date().toISOString()};let service;const providers=createDesktopProviders({hostLabel:'누비 양식 대화 점검'});
try{
  await mkdir(path.join(root,'서식'),{recursive:true});await git(root,['init','-q']);await git(root,['config','user.email','eval@example.invalid']);await git(root,['config','user.name','Eval']);
  await writeFile(path.join(root,'README.md'),'# 양식 대화 점검\n');original=await docxFromBlocks(FORMS.trip);await writeFile(path.join(root,'서식','출장.docx'),original);await git(root,['add','.']);await git(root,['commit','-qm','init']);
  await providers.connect({provider:'claude'});await providers.model(model);
  service=new ProjectService({storageRoot:path.join(dir,'state')});await service.open(root);service.providers=providers;service.formOpen=false;
  const task=await service.createTask({request:'서식/출장.docx 양식으로 출장 결과 보고서를 써 줘. 출장자 이서준, 소속 기술지원팀, 출장지 대전 연구단지. 목적은 장비 점검이고, 결과는 장비 교체 완료와 다음 달 후속 점검 예정이야.'});
  await service.startAgent({taskId:task.id});await service.agent.promise;
  let current=service.task(task.id);const first=current.messages.filter(m=>m.role==='assistant').at(-1)?.content??'';
  report.firstTurn={state:current.state,question:current.question?(typeof current.question==='string'?current.question:current.question.text):null,assistant:String(first).slice(0,600)};
  const reply='출장 기간은 2026. 11. 3. ~ 2026. 11. 4.이야.';
  if(current.state==='waiting_input'&&current.question)await service.answerAgent({taskId:task.id,answer:reply});else await service.startAgent({taskId:task.id,answer:reply});
  await service.agent.promise;current=service.task(task.id);
  report.secondTurn={state:current.state,assistant:String(current.messages.filter(m=>m.role==='assistant').at(-1)?.content??'').slice(0,600)};
  const tools=(current.trace||[]).map(step=>step.tool??step.name).filter(Boolean);report.tools=[...new Set(tools)];
  const copy=path.join(root,'문서','출장 작성.docx');let items=null;try{items=(await docxSnapshot(await readFile(copy))).items;}catch{}
  const cell=id=>items?.find(item=>item.id===id)?.text??null;
  report.copy=items?{출장자:cell('t1/r1/c2'),소속:cell('t1/r1/c4'),출장지:cell('t1/r2/c2'),기간:cell('t1/r3/c2')}:null;
  report.originalUnchanged=(await readFile(path.join(root,'서식','출장.docx'))).equals(original);
  report.success=report.originalUnchanged&&!!items&&/이서준/.test(report.copy.출장자??'')&&/2026/.test(report.copy.기간??'')&&/기간/.test(report.firstTurn.assistant+(report.firstTurn.question??''));
}catch(error){report.error=String(error?.message??error).slice(0,300);}
finally{service?.dispose();service?.store?.close?.();providers.dispose?.();await rm(dir,{recursive:true,force:true}).catch(()=>{});}
await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,1)+'\n');console.log(JSON.stringify(report,null,1));
