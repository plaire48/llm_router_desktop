// Filling a Word form from the conversation (document forms Task K, 2026-10-21, user decision): no register button and
// no form card. The agent names the document (or uses the Word document open in Office for this task), the form is
// recognized from the document itself every time, values come from the person's own messages, a value the messages do
// not give is asked once in the chat, and the filled copy (never the original) is written and opened in Office.
import path from 'node:path';
import {readFile,readdir,lstat,mkdir,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {startDirectFormPlan} from './document-forms-service.mjs';
import {nativeOfficeHost} from './native-office-host.mjs';
import {scopedFile} from './files.mjs';

const LIMIT=20*1024*1024;
export const DOCUMENT_FORM_TOOL={type:'function',function:{name:'fill_document_form',
  description:'Write a document with a Word form (양식): fills a new copy from the user\'s words and opens it. On needs_values ask all in one message, then call with answers.',
  parameters:{type:'object',additionalProperties:false,properties:{source:{type:'string',maxLength:1000},answers:{type:'object',maxProperties:60,additionalProperties:{type:'string',maxLength:2000}},output:{type:'string',maxLength:1000}}}}};

// Offered only when a form may be meant (the schema budget has no room for an always-on tool): a Word document is
// connected in Office for this task, or the person's words name a form or a .docx file.
const FORM_WORDS=/양식|서식|템플릿|template|form\b|\.docx\b/i;
export function documentFormRelevant(service,task){
  if(nativeOfficeHost(service,task.id)?.app==='word')return true;
  return FORM_WORDS.test(userWords(task));
}
const plans=new WeakMap();
const planFor=service=>{let map=plans.get(service);if(!map){map=new Map();plans.set(service,map);}return map;};
const isDocx=file=>/\.docx$/i.test(file);
// The person's own words are the evidence: the request and every later message the user wrote in this task.
function userWords(task){
  const messages=(task.messages||[]).filter(message=>message.role==='user'&&typeof message.content==='string').map(message=>message.content);
  return [task.request,...messages].filter(text=>typeof text==='string'&&text.trim()).slice(-8).join('\n\n').slice(0,12000);
}
// The Word document bound to this task in Office: its title is looked up in the Workspace (Office does not give its path).
async function findByTitle(workspace,title){
  if(!title||!isDocx(title))return [];
  const found=[],queue=[workspace];let seen=0;
  while(queue.length&&seen<4000&&found.length<3){
    const dir=queue.shift();let entries=[];try{entries=await readdir(dir,{withFileTypes:true});}catch{continue;}
    for(const entry of entries){seen++;if(entry.name.startsWith('.')||entry.name==='node_modules')continue;const file=path.join(dir,entry.name);if(entry.isDirectory())queue.push(file);else if(entry.isFile()&&entry.name===title)found.push(file);}
  }
  return found;
}
async function resolveSource(service,task,args,workspace){
  const host=nativeOfficeHost(service,task.id),office=host?.app==='word'?host:null;
  let file,fromOffice=false;
  if(typeof args.source==='string'&&args.source.trim())file=await scopedFile(workspace,args.source.trim().replaceAll('\\','/').replace(/^\.\//,''));
  else if(office){
    const matches=await findByTitle(workspace,office.document?.documentTitle);
    if(matches.length!==1)return {error:matches.length?'form_source_ambiguous':'form_source_outside_workspace',instruction:matches.length?'Several files in the Workspace have this name; ask which one to use.':'The Word document open in Office is not in this Workspace. Ask the user to save it into the Workspace (or name its Workspace path) and try again.'};
    file=matches[0];fromOffice=true;
  }else return {error:'form_source_required',instruction:'Ask which Word (.docx) file to use, or ask the user to open it in Office and connect it to this conversation.'};
  if(!isDocx(file))return {error:'form_format_unsupported',instruction:'Only Word .docx forms are filled now; Excel and PowerPoint forms come in 1.3.1.'};
  const stat=await lstat(file).catch(()=>null);if(!stat?.isFile())return {error:'form_source_missing',instruction:'The file was not found; ask the user for its Workspace path.'};
  if(stat.size>LIMIT)return {error:'form_source_too_large'};
  // When the same document is open in Office, Office confirms it reads the saved file (path and saved state).
  if(office){
    const scratch=path.join(workspace,'.nubi','forms','.capture-'+randomUUID().slice(0,8));await mkdir(scratch,{recursive:true});
    try{await office.call('office_capture_template',{path:await realpath(file),outDir:scratch,maxAssets:200,renders:false});}
    catch(error){
      const code=/^[a-z_]+$/.test(error?.message||'')?error.message:'form_capture_failed';
      // A named file need not be the one open in Office; a file found by the open document's title must be it.
      if(code==='form_capture_source_mismatch'){if(fromOffice)return {error:'form_source_outside_workspace',instruction:'The Word document open in Office is not the Workspace file of the same name. Ask the user to save it into the Workspace or name its path.'};}
      else if(code==='form_capture_unsaved')return {error:code,instruction:'Ask the user to save the document in Word first; the form is read from the saved file.'};
      else return {error:code,instruction:'Office could not read the document. Ask the user to check that it is open and connected.'};
    }
  }
  return {file,bytes:await readFile(file),office:!!office};
}
const nextName=base=>path.posix.join('문서',`${base} 작성.docx`);
async function freeOutput(workspace,wanted){
  let rel=wanted;for(let n=2;n<100;n++){const exists=await lstat(path.join(workspace,rel)).then(()=>true,()=>false);if(!exists)return rel;rel=wanted.replace(/\.docx$/i,` (${n}).docx`);}
  return wanted;
}
// Opens the filled copy with the system's default app (Word on the company PC); a failure leaves the path to report.
export function openWithDefaultApp(file,{platform=process.platform,spawnProcess=spawn}={}){
  try{
    const child=platform==='win32'?spawnProcess('explorer.exe',[file],{detached:true,stdio:'ignore',windowsHide:false}):platform==='darwin'?spawnProcess('open',[file],{detached:true,stdio:'ignore'}):spawnProcess('xdg-open',[file],{detached:true,stdio:'ignore'});
    child.on?.('error',()=>{});child.unref?.();return true;
  }catch{return false;}
}
const questionsOf=view=>(view.sheet?.missing??[]).map(entry=>({slot:entry.slot,label:entry.label,question:entry.question}));
async function summarize(service,task,view,{open,workspace}){
  if(view.state==='asking')return {ok:true,state:'needs_values',questions:questionsOf(view),instruction:'Ask the user for every value listed, in ONE chat message in Korean (no form). Then call fill_document_form again with answers keyed by slot.'};
  if(view.state==='written'){
    const output=view.written.output,absolute=path.join(workspace,output),opened=open?openWithDefaultApp(absolute):false;
    planFor(service).delete(task.id);
    return {ok:true,state:'written',output,opened,checks:view.checks?.summary??null,changes:view.written.counts??null,unmet:view.checks?.unmet??[],
      instruction:'Tell the user the copy was written (and opened in Office when opened is true), what was filled, and anything the checks did not confirm. The original was not changed.'};
  }
  if(view.state==='failed'){planFor(service).delete(task.id);return {ok:false,error:view.error??'form_plan_failed',issue:view.issue??null};}
  return {ok:false,error:'form_plan_'+view.state};
}
// open: evaluations set service.formOpen=false so a run does not open Word on the machine that measures.
export async function fillDocumentForm(service,task,args={},{open=service.formOpen!==false}={}){
  const workspace=await service.target(task.id),call=extra=>service.documentForm({projectId:service.projectId,taskId:task.id,...extra});
  const current=planFor(service).get(task.id);
  if(current&&args.answers&&typeof args.answers==='object'){
    let view=await call({action:'answer',planId:current.planId,answers:args.answers});
    if(view.state==='ready')view=await call({action:'apply',planId:current.planId,output:current.output});
    for(let n=0;view.state==='approval'&&n<3;n++)view=await call({action:'apply',planId:current.planId,output:current.output});
    return summarize(service,task,view,{open,workspace});
  }
  const source=await resolveSource(service,task,args,workspace);
  if(source.error)return {ok:false,...source};
  const request=userWords(task);if(!request)return {ok:false,error:'form_request_required',instruction:'Ask the user what to write in the form.'};
  const started=await startDirectFormPlan(service,{taskId:task.id,bytes:source.bytes,documentPath:source.file,request});
  if(started.notFillable)return {ok:false,error:'form_not_fillable',reason:started.notFillable};
  const base=path.basename(source.file,path.extname(source.file));
  const output=typeof args.output==='string'&&/\.docx$/i.test(args.output)?args.output.replaceAll('\\','/'):await freeOutput(workspace,nextName(base));
  planFor(service).set(task.id,{planId:started.planId,output});
  let view=started;
  if(view.state==='ready')view=await call({action:'apply',planId:started.planId,output});
  for(let n=0;view.state==='approval'&&n<3;n++)view=await call({action:'apply',planId:started.planId,output});
  return summarize(service,task,view,{open,workspace});
}
