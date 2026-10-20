// The form-filling service (document forms plan Task C and D, 2026-10-21): one ProjectService method, documentForm,
// that registers and lists forms (Task B), runs the Office fill (createFormFill) on a registered form with the
// Desktop's own model transport, and writes the checked sheet into a copy of the form inside the Workspace.
// The model writes a fill sheet from the person's words and the materials they chose (Workspace files, wiki or mail
// passages the caller hands over); every value names its source and quote. A value no material supports is asked, all
// open slots in one card, and the sheet is written again with the answers. Writing (apply) goes to a copy only, never
// to the form's source file; the copy is read back after every part and checked against the map.
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createFormFill,modelJson} from '../generated/office-forms.mjs';
import {registerForm,loadForm,listForms,formQuestionPlan} from './document-forms.mjs';
import {createDocxWriter,verifyDocxCopy} from './docx-apply.mjs';
import {renderBeforeAfter} from './document-render.mjs';
import {FORMS_DIR} from './document-forms.mjs';
import {modelTransport} from './recovery.mjs';
import {readSource,scopedFile,fail} from './files.mjs';

const PLAN_LIMIT=8,FILE_LIMIT=10,FILE_CHARS=20000,PASSAGE_LIMIT=40,PASSAGE_CHARS=4000;
const requireProject=(service,projectId)=>{service.ready();if(projectId!==service.projectId)fail('project_changed');};
const plansOf=service=>service.documentFormPlans??=new Map();
const safeCode=error=>/^[a-z_]+$/.test(error?.message||'')?error.message:'form_plan_failed';

export function installDocumentForms(Service){
  Service.prototype.documentForm=async function(args={}){
    requireProject(this,args.projectId);
    const action=args.action,workspace=await this.target(args.taskId);
    if(action==='register'){
      if(typeof args.source!=='string'||!args.source)fail('form_source_required');
      const source=path.isAbsolute(args.source)?args.source:path.join(workspace,args.source);
      const {name,hash,preview}=await registerForm({workspace,source,name:args.name});return {name,hash,preview};
    }
    if(action==='list')return {forms:await listForms(workspace)};
    if(action==='questions'){const {map,hash,changed}=await loadForm(workspace,args.name);return {hash,changed,...formQuestionPlan(map,args.values&&typeof args.values==='object'?args.values:{})};}
    if(action==='plan')return startPlan(this,workspace,args);
    if(action==='answer')return answerPlan(this,args);
    if(action==='apply')return applyPlan(this,workspace,args);
    if(action==='render')return renderPlan(this,workspace,args);
    if(action==='status')return view(planOf(this,args.planId));
    if(action==='cancel'){const plan=planOf(this,args.planId);plan.state='cancelled';plan.controller.abort();plansOf(this).delete(plan.id);return {cancelled:true};}
    fail('document_form_action_invalid');
  };
}
function planOf(service,planId){const plan=plansOf(service).get(planId);if(!plan)fail('form_plan_missing');return plan;}

/** The materials a value may come from, as the fill's conversation sources (history-N), with what each one was. */
async function gatherSources(workspace,sources={}){
  const history=[],refs=[];
  const files=Array.isArray(sources.files)?sources.files.filter(x=>typeof x==='string').slice(0,FILE_LIMIT):[];
  for(const file of files){const read=await readSource(workspace,file);history.push({role:'user',content:read.content.slice(0,FILE_CHARS)});refs.push({kind:'file',ref:file});}
  const passages=Array.isArray(sources.passages)?sources.passages.slice(0,PASSAGE_LIMIT):[];
  for(const passage of passages){
    if(!passage||typeof passage.text!=='string'||!passage.text.trim())continue;
    const kind=['wiki','mail','file','note'].includes(passage.kind)?passage.kind:'note';
    history.push({role:'user',content:passage.text.slice(0,PASSAGE_CHARS)});refs.push({kind,ref:String(passage.ref??'').slice(0,200)});
  }
  return {history,refs};
}
const labelOf=(map,id)=>map.slots.find(slot=>slot.id===id)?.label??map.sections.find(section=>section.id===id)?.title??id;
function sourceView(plan,source,quote){
  const match=/^history-(\d+)$/.exec(source||'');
  const ref=match?plan.refs[Number(match[1])-1]:null;
  return {id:source,kind:source==='request'?'request':source?.startsWith('answer-')?'answer':ref?.kind??'history',...(ref?.ref?{ref:ref.ref}:{}),...(quote?{quote:String(quote).slice(0,600)}:{})};
}
function view(plan){
  const {sheet,checks,unresolved,remaining}=plan.fill.state(),map=plan.map;
  const cells=sheet.cells.map(cell=>({slot:cell.slot,label:labelOf(map,cell.slot),value:cell.value,source:sourceView(plan,cell.source,cell.quote)}));
  const rows=sheet.rows.map(entry=>({slot:entry.slot,label:labelOf(map,entry.slot),header:map.slots.find(slot=>slot.id===entry.slot)?.header??[],rows:entry.rows,source:sourceView(plan,entry.source,entry.quote)}));
  const sections=sheet.sections.map(entry=>({section:entry.section,title:labelOf(map,entry.section),paragraphs:entry.paragraphs.map(p=>p.text),sources:(plan.sectionSources.get(entry.section)??[]).map(source=>sourceView(plan,source))}));
  return {planId:plan.id,name:plan.name,hash:plan.hash,state:plan.state,error:plan.error,
    questions:plan.state==='asking'?plan.questions:[],
    sheet:{cells,rows,sections,missing:sheet.missing.map(entry=>({slot:entry.slot,label:labelOf(map,entry.slot),question:entry.question}))},
    evidence:[...cells.map(cell=>({target:cell.slot,...cell.source})),...rows.map(row=>({target:row.slot,...row.source})),...sections.flatMap(section=>section.sources.map(source=>({target:section.section,...source})))],
    answered:[...plan.answered.keys()],activity:plan.activity.slice(-20),
    ...(plan.state==='approval'&&plan.card?{card:plan.card}:{}),
    ...(plan.output?{output:plan.output}:{}),
    ...(checks?{checks:{summary:checks.summary,failed:checks.failed,unmet:checks.checks.filter(c=>!c.met).map(c=>({criterion:c.criterion,detail:c.detail??'',slot:c.slot,section:c.section}))}}:{}),
    ...(unresolved?.length?{unresolved:unresolved.map(c=>({item:c.item,target:c.target,status:c.status}))}:{}),
    ...(remaining?{remaining:{slots:remaining.slots,sections:remaining.sections,what:remaining.what}}:{}),
    ...(plan.written?{written:plan.written}:{}),
    ...(plan.render?{render:plan.render}:{})};
}
/** Resolves when the run ends or stops to ask or to wait for an approval. */
const settle=plan=>new Promise(resolve=>{plan.onAsk=resolve;plan.run.finally(resolve);}).then(()=>{plan.onAsk=null;});
const pause=(plan,state)=>{plan.state=state;plan.onAsk?.();return new Promise((resolve,reject)=>{plan.resume=resolve;plan.controller.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});});};

async function startPlan(service,workspace,args){
  const {map,items,hash,source}=await loadForm(workspace,args.name);
  if(!items)fail('form_items_missing');
  const request=String(args.request??'').trim();if(!request)fail('form_request_required');
  if(!service.providers?.status?.()?.connected)fail('provider_missing');
  const {history,refs}=await gatherSources(workspace,args.sources);
  const controller=new AbortController(),invoke=modelTransport(service,{signal:controller.signal});
  const plan={id:'form-plan:'+randomUUID(),name:args.name,hash,map,source,workspace,request,answers:[],history,refs,controller,state:'running',error:null,questions:[],pending:null,answered:new Map(),pushed:new Set(),sectionSources:new Map(),activity:[],onAsk:null,createdAt:Date.now(),
    card:null,approvals:0,writer:null,output:null,written:null,
    requirements:Array.isArray(args.requirements)?args.requirements.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim().slice(0,300)).slice(0,20):[]};
  // The model answers in the sheet's JSON; a refused sheet goes back with the reason, at most three tries.
  const structured=async(build,parse,{responseFormat}={})=>{
    let feedback='';
    for(let attempt=0;;attempt++){
      const messages=build(feedback),result=await invoke(messages,[],controller.signal,'form_fill',{retryInvalidResponse:false,maxTokens:4096,...(responseFormat?{responseFormat}:{})});
      try{const value=parse(result);
        // The section parser keeps the paragraphs only; the sources the model named are kept here as the evidence.
        if(responseFormat?.json_schema?.name==='form_section'){try{const raw=modelJson(result?.content),id=JSON.parse(messages.at(-1).content)?.section?.id;if(id&&Array.isArray(raw?.sources))plan.sectionSources.set(id,raw.sources.filter(x=>typeof x==='string').slice(0,10));}catch{/* evidence is optional */}}
        return value;}
      catch(error){if(error?.message!=='document_schema_invalid'||attempt>=2)throw error;feedback=String(error.issue||'Return the JSON object exactly as asked.').slice(0,1500);}
    }
  };
  // The fill asks one missing value at a time; the card shows every open slot at once and the answers come back
  // together, so later asks for answered slots pass straight through.
  const push=key=>{if(plan.answered.has(key)&&!plan.pushed.has(key)){plan.pushed.add(key);plan.answers.push({text:plan.answered.get(key)});}};
  const ask=async question=>{
    const text=String(question?.question??'').slice(0,300),missing=plan.fill.state().sheet.missing;
    const key=missing.find(entry=>entry.question===text)?.slot??text;
    if(plan.answered.has(key)){push(key);return;}
    plan.questions=missing.map(entry=>({slot:entry.slot,label:labelOf(map,entry.slot),question:entry.question,...(map.slots.find(slot=>slot.id===entry.slot)?.valueType?{kind:map.slots.find(slot=>slot.id===entry.slot).valueType}:{})}));
    if(!plan.questions.some(entry=>entry.slot===key))plan.questions.push({slot:key,label:labelOf(map,key),question:text,kind:question?.input_mode==='long_text'?'long_text':'text'});
    plan.pending={key,question:text};
    await pause(plan,'asking');
    plan.pending=null;plan.state='running';push(key);
  };
  // The first card is approved by the apply call itself (the person saw the sheet); a repaired sheet waits for the
  // next apply call, so nothing is written that the person did not see.
  const approval=async card=>{
    plan.card={kind:card.kind,title:card.title,summary:card.summary,target:card.target,verification:card.verification,fill:card.fill};
    if(plan.approvals>0){await pause(plan,'approval');plan.state='running';}
    plan.approvals++;
  };
  const read=async()=>{if(!plan.writer)fail('form_apply_not_ready');return plan.writer.read();};
  const write=async op=>{if(!plan.writer)fail('form_apply_not_ready');return plan.writer.apply(op);};
  plan.fill=createFormFill({map,items,request,answers:plan.answers,history:plan.history,requirements:plan.requirements,structured,ask,approval,read,write,
    activity:{note:(text,kind)=>{plan.activity.push({text:String(text).slice(0,500),kind:String(kind??'').slice(0,40),at:new Date().toISOString()});}}});
  plan.run=(async()=>{for(const step of plan.fill.steps())if(step.kind!=='form_apply')await plan.fill.run(step);})()
    .then(()=>{if(plan.state!=='cancelled')plan.state='ready';},error=>{if(plan.state!=='cancelled'){plan.state='failed';plan.error=safeCode(error);}});
  const plans=plansOf(service);plans.set(plan.id,plan);
  while(plans.size>PLAN_LIMIT){const oldest=plans.keys().next().value;plans.get(oldest).controller.abort();plans.delete(oldest);}
  await settle(plan);return view(plan);
}
async function answerPlan(service,args){
  const plan=planOf(service,args.planId);
  if(plan.state!=='asking'||!plan.pending)fail('form_plan_not_asking');
  const answers=args.answers&&typeof args.answers==='object'&&!Array.isArray(args.answers)?args.answers:{};
  for(const [slot,value] of Object.entries(answers)){
    if(typeof value!=='string'||!value.trim())continue;
    // The answer is kept as the person's words with the slot's label, so the sheet can quote it.
    plan.answered.set(slot,`${labelOf(plan.map,slot)}: ${value.trim().slice(0,2000)}`);
  }
  const resume=plan.resume;plan.resume=null;resume?.();
  await settle(plan);return view(plan);
}
/** Writes the sheet into a copy at `output` (a .docx path inside the Workspace, never the form's source). */
async function applyPlan(service,workspace,args){
  const plan=planOf(service,args.planId);
  if(plan.state==='approval'&&plan.resume){const resume=plan.resume;plan.resume=null;resume();await settle(plan);return finish(plan);}
  if(plan.state!=='ready')fail('form_plan_not_ready');
  if(typeof args.output!=='string'||!/\.docx$/i.test(args.output))fail('form_output_invalid');
  // The copy stays inside the Workspace: a relative path without '..', its folder made if needed.
  const relative=path.normalize(args.output);if(path.isAbsolute(relative)||relative.split(path.sep).includes('..'))fail('form_output_invalid');
  await mkdir(path.dirname(path.join(workspace,relative)),{recursive:true});
  const target=await scopedFile(workspace,relative,{newFile:true});
  if(!plan.source)fail('form_source_missing');
  const source=await scopedFile(workspace,plan.source);
  if(path.resolve(target)===path.resolve(source))fail('form_source_protected');
  const exists=await lstat(target).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
  if(exists&&args.overwrite!==true)fail('form_output_exists');
  const bytes=await readFile(source).catch(error=>{if(error.code==='ENOENT')fail('form_source_missing');throw error;});
  plan.writer=await createDocxWriter(bytes,{name:path.basename(plan.source)});plan.output=args.output;plan.sourceBytes=bytes;plan.state='running';
  plan.run=plan.fill.run({kind:'form_apply'}).then(()=>{if(plan.state!=='cancelled')plan.state='applied';},error=>{if(plan.state!=='cancelled'){plan.state='failed';plan.error=safeCode(error);plan.issue=String(error?.issue??'').slice(0,500)||null;}});
  await settle(plan);return finish(plan);
}
/** After the apply run: the copy is saved when the run ended, whatever the checks say; nothing is saved while it waits. */
async function finish(plan){
  if(plan.state==='applied'&&plan.writer&&!plan.written){
    const copy=await plan.writer.bytes();
    const target=await scopedFile(plan.workspace,plan.output,{newFile:true});
    await mkdir(path.dirname(target),{recursive:true});await writeFile(target,copy);
    const targets=[...plan.map.slots.map(slot=>slot.target),...plan.writer.applied.flatMap(entry=>[entry.operation.targetId,...(entry.receipt?.inserted??[])].filter(Boolean))];
    const verify=await verifyDocxCopy(plan.sourceBytes,copy,{targets});
    plan.written={output:plan.output,operations:plan.writer.applied.length,sameEntries:verify.sameEntries,changedParagraphs:verify.changedParagraphs.length,violations:verify.violations.map(item=>item.id),at:new Date().toISOString()};
    plan.state='written';
  }
  return view(plan);
}
/** Before/after page renders of a written plan, under the form's folder; unavailable without LibreOffice. */
async function renderPlan(service,workspace,args){
  const plan=planOf(service,args.planId);
  if(plan.state!=='written'||!plan.written)fail('form_plan_not_written');
  const source=await scopedFile(workspace,plan.source),copy=await scopedFile(workspace,plan.written.output);
  const relative=path.posix.join(FORMS_DIR,plan.name,'renders',plan.id.slice(-8));
  await mkdir(path.join(workspace,relative),{recursive:true});
  const outDir=await scopedFile(workspace,relative);
  const {before,after}=await renderBeforeAfter({source,copy,outDir,...(args.soffice===false?{soffice:false}:{}),timeoutMs:180000,maxPages:8});
  const view=result=>({status:result.status,...(result.reason?{reason:result.reason}:{}),engine:result.engine,pageCount:result.pageCount,pages:result.pages.map(page=>({index:page.index,path:path.relative(workspace,page.path).split(path.sep).join('/')}))});
  plan.render={before:view(before),after:view(after),at:new Date().toISOString()};
  return {planId:plan.id,render:plan.render};
}
