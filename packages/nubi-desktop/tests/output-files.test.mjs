import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,symlink,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {registerOutput,OUTPUT_LIMIT} from '../runtime/output-files.mjs';
import {storeAgentCapture,storeCaptures} from '../runtime/captures.mjs';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);
async function files(t){const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-output-')),root=path.join(directory,'project');await mkdir(root);t.after(()=>rm(directory,{recursive:true,force:true}));return {root,directory};}
test('registers exact bytes and kinds; refuses missing, directories, private and outside paths',async t=>{
 const {root}=await files(t),task={id:'t',outputs:[]};
 for(const [name,kind] of [['report.md','text'],['capture.png','image'],['report.pdf','pdf'],['report.docx','office'],['report.xlsx','office'],['report.pptx','office']]){
  await writeFile(path.join(root,name),'# 보고');const card=await registerOutput({root},task,{path:name,caption:'요약 보고',runId:name});
  assert.equal(card.kind,kind);assert.equal(card.path,name);assert.equal(card.size,Buffer.byteLength('# 보고'));assert.equal(card.caption,'요약 보고');assert(card.id&&card.at);
 }
 for(const name of ['../outside.txt',path.join(root,'report.md'),'.env','a/../../x'])await assert.rejects(registerOutput({root},task,{path:name,runId:'r'}),/output_outside/);
 for(const name of ['missing.md',''])await assert.rejects(registerOutput({root},task,{path:name,runId:'r'}),/output_(invalid|outside)/);
 await mkdir(path.join(root,'dir'));await assert.rejects(registerOutput({root},task,{path:'dir',runId:'r'}),/output_invalid/);assert.equal(task.outputs.length,6);
});
test('neither a leaf symlink nor a parent directory symlink can escape the root',async t=>{
 const {root,directory}=await files(t);await writeFile(path.join(directory,'outside.txt'),'private');await symlink(path.join(directory,'outside.txt'),path.join(root,'leaf.txt'));await symlink(directory,path.join(root,'parent'),'dir');
 for(const name of ['leaf.txt','parent/outside.txt'])await assert.rejects(registerOutput({root},{id:'t'},{path:name,runId:'r'}),/output_(outside|invalid)/);
});
test('limits each run to five outputs without removing other runs, including concurrent registration',async t=>{
 const {root}=await files(t);await writeFile(path.join(root,'report.md'),'report');const task={id:'t',outputs:[{id:'old',runId:'old'}]};
 const results=await Promise.allSettled(Array.from({length:OUTPUT_LIMIT+2},()=>registerOutput({root},task,{path:'report.md',runId:'r'})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,OUTPUT_LIMIT);assert(results.filter(r=>r.status==='rejected').every(r=>/output_card_limit/.test(r.reason.message)));assert.equal(task.outputs[0].id,'old');
 await registerOutput({root},task,{path:'report.md',runId:'next'});assert.equal(task.outputs.length,OUTPUT_LIMIT+2);
});
test('capture cards keep references only and require the same host task and run',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'화면 확인'}),image=Buffer.from('png fixture').toString('base64');
 const capture=storeAgentCapture(service,task.id,'run',{image,width:20,height:10},'web');
 const card=await registerOutput(service,task,{captureId:capture.id,caption:'결과 화면',runId:'run'});assert.equal(card.kind,'image');assert.equal(card.captureId,capture.id);assert.equal(card.size,Buffer.from(image,'base64').length);assert(!JSON.stringify(task.outputs).includes(image));
 for(const candidate of [{...task,id:'other'},task])await assert.rejects(registerOutput(service,candidate,{captureId:capture.id,runId:candidate===task?'other':'run'}),/output_invalid/);
 const [input]=storeCaptures(service,task.id,[{image,width:20,height:10}]);await assert.rejects(registerOutput(service,task,{captureId:input.id,runId:'run'}),/output_invalid/);
 await assert.rejects(registerOutput(service,task,{path:'app.txt',captureId:capture.id,runId:'run'}),/output_invalid/);
 await assert.rejects(registerOutput(service,task,{captureId:capture.id}),/output_invalid/);
});
test('the agent advertises send_file and persists its host run binding without replacing old outputs',async t=>{
 const {service,root}=await fixture(t);await writeFile(path.join(root,'report.md'),'# 보고');const task=await service.createTask({request:'작성한 보고서를 전달해 주세요.'});
 service.store.set('task:'+task.id,{...service.task(task.id),outputs:[{id:'old',path:'old.txt',runId:'previous'}]});let step=0,advertised=false;
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},complete:async(messages,tools)=>{advertised ||= tools.some(row=>row.function.name==='send_file');return step++===0?{content:'',calls:[{id:'output-call',type:'function',function:{name:'send_file',arguments:JSON.stringify({path:'report.md',caption:'보고서'})}}]}:{content:'보고서를 준비했어요.',calls:[]};}};
 await service.startAgent({taskId:task.id});await service.agent.promise;const saved=service.task(task.id);assert(advertised);assert.equal(saved.outputs.length,2,JSON.stringify(saved.trace));assert.equal(saved.outputs[0].id,'old');assert.equal(saved.outputs[1].runId,saved.messages.findLast(m=>m.role==='assistant').runId);assert(saved.trace.some(row=>row.tool==='send_file'&&row.status==='done'));
});
test('host capture preview resolves a registered output and rejects cross-task, project and changed records',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'캡처'}),other=await service.createTask({request:'다른 대화'}),image=Buffer.from('png fixture').toString('base64');const capture=storeAgentCapture(service,task.id,'run',{image,width:20,height:10},'web');
 const card=await registerOutput(service,task,{captureId:capture.id,runId:'run'});service.store.set('task:'+task.id,task);
 const args={projectId:service.projectId,taskId:task.id,outputId:card.id};const preview=await service.previewFile(args);assert.equal(preview.content,'data:image/png;base64,'+image);assert.equal(preview.root,service.root);
 await assert.rejects(service.previewFile({...args,taskId:other.id}),/output_invalid/);await assert.rejects(service.previewFile({...args,projectId:'other'}),/project_changed/);
 const record=service.store.get('capture:'+capture.id);service.store.set('capture:'+capture.id,{...record,runId:'changed'});await assert.rejects(service.previewFile(args),/output_invalid/);
});

test('F4 agent receives output_outside and a trace reason instead of a generic execution failure',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'파일 전달'});let n=0;const returned=[];
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async messages=>{for(const m of messages.filter(m=>m.role==='tool')){try{returned.push(JSON.parse(m.content));}catch{}}return n++===0?{content:'',calls:[{id:'bad-output',type:'function',function:{name:'send_file',arguments:JSON.stringify({path:'../outside.txt',caption:'파일'})}}]}:{content:'프로젝트 내부 파일을 확인해야 합니다.',calls:[]};}};
 await service.startAgent({taskId:task.id});await service.agent.promise;assert(returned.some(r=>r.error==='output_outside'&&r.actionIssued===false));assert(service.task(task.id).trace.some(r=>r.tool==='send_file'&&r.reason==='output_outside'));
});

test('F12 output captions remove invisible controls and reject supplied invisible-only text',async t=>{
 const {root}=await files(t),task={id:'t'};await writeFile(path.join(root,'report.md'),'report');
 for(const caption of ['\u200b','\u0007\u009f',' \u202e '])await assert.rejects(registerOutput({root},task,{path:'report.md',caption,runId:'r'}),/output_invalid/);
 const card=await registerOutput({root},task,{path:'report.md',caption:'결과 \u200b  보고\u202e',runId:'r'});assert.equal(card.caption,'결과 보고');
 const optional=await registerOutput({root},task,{path:'report.md',runId:'r'});assert.equal(optional.caption,'');
});
