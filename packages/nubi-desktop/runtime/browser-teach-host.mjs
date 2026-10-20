// The teach panel's host connection (browser teach plan T8, workflow design §8 답 32, 2026-10-21).
// One ProjectService method, browserTeach, carries the whole path: list recordable tabs, start and stop a
// demonstration recording in the product browser, build the draft card, run a one-time trial of that draft, save
// it as a draft script, and promote it to reviewed after the person inspected the trial's captures.
//
// Authority never comes from client values. The host keeps a session per recording in memory with the demonstrated
// values (which never enter a card or a file), the steps hash the draft must keep, the trial receipts and their
// captures. Every call is checked against that session, the current project and the saved script on disk. The
// UI's draftKey is echoed back only so a late answer can be discarded.
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {demonstrationCard} from '../generated/browser-agent-core.mjs';
import {recordStep,recordTarget} from '../../../extensions/aipro-chat/browser-replay.js';
import {saveBrowserScript,loadBrowserScript,listBrowserScripts,reviewBrowserScript,recordBrowserScriptRun,validateBrowserScriptCard,safeScriptSlug,BROWSER_SCRIPTS_DIR} from './browser-scripts.mjs';
import {runBrowserCard} from './browser-card-run.mjs';
import {scopedFile,hash,fail} from './files.mjs';

const SESSION_LIMIT=8;
const SLUG_CHARS=/[^a-z0-9가-힣-]+/g;
const stepsHashOf=card=>hash(JSON.stringify(card.steps));
const requireProject=(service,projectId)=>{service.ready();if(projectId!==service.projectId)fail('project_changed');};
const sessionsOf=service=>service.browserTeachSessions??=new Map();

/** A readable folder name from the title; Korean is allowed by the store. */
export function scriptSlugFromTitle(title){
  const base=String(title||'').trim().toLowerCase().replace(/\s+/g,'-').replace(SLUG_CHARS,'').replace(/-+/g,'-').replace(/^-+|-+$/g,'').slice(0,61);
  return /^[a-z0-9가-힣]/.test(base)?base:'script-'+randomUUID().slice(0,6);
}
async function freeSlug(workspace,wanted,stepsHash){
  for(let n=1;n<=20;n++){
    const slug=n===1?wanted:`${wanted.slice(0,58)}-${n}`;
    const existing=await loadBrowserScript(workspace,slug).catch(error=>{if(error.message==='browser_script_missing')return null;throw error;});
    // The same steps may be saved again under their slug; another script's folder is never replaced.
    if(!existing||existing.card.stepsHash===stepsHash)return slug;
  }
  fail('browser_script_slug_taken');
}
function session(service,binding){
  if(!binding||typeof binding!=='object')fail('browser_teach_session_invalid');
  requireProject(service,binding.projectId);
  const found=sessionsOf(service).get(binding.sessionId);
  if(!found||found.projectId!==binding.projectId||found.revision!==binding.revision)fail('browser_teach_session_invalid');
  return found;
}
function sameSteps(found,card){
  validateBrowserScriptCard(card);
  if(stepsHashOf(card)!==found.stepsHash)fail('browser_teach_card_changed');
  return card;
}
const scriptView=card=>({slug:card.id,hash:card.stepsHash,version:card.version,status:card.status});
// The product replays against the accessibility snapshot, which carries no surrounding text. A recorded context
// (the page script's nearest row or parent text) can then only block the match, so it is used for labels and
// dropped from the targets. Same-looking controls stay a stop (§8 질문 30).
function portableTargets(card){
  const strip=target=>{if(target&&typeof target==='object')delete target.context;};
  for(const step of card.steps){strip(step.target);for(const field of step.fields??[])strip(field.target);}
  return card;
}

export function installBrowserTeach(Service){
  Service.prototype.browserTeach=async function(args={}){
    const action=args.action;
    if(action==='tabs'){requireProject(this,args.projectId);if(typeof this.playwrightRequest!=='function')fail('workflow_browser_unavailable');return this.playwrightRequest('tabs',{});}
    if(action==='list'){requireProject(this,args.projectId);return {scripts:await listBrowserScripts(await this.target(args.taskId))};}
    if(action==='record')return record(this,args);
    if(action==='test')return trial(this,args);
    if(action==='save')return save(this,args);
    if(action==='approve')return approve(this,args);
    if(action==='discard'){const found=session(this,args.binding);sessionsOf(this).delete(found.sessionId);return {discarded:true};}
    fail('browser_teach_action_invalid');
  };
}

async function record(service,args){
  requireProject(service,args.projectId);
  if(typeof service.playwrightRequest!=='function')fail('workflow_browser_unavailable');
  if(typeof args.tabId!=='string'||!args.tabId)fail('browser_tab_required');
  if(args.op==='start'||args.op==='status')return service.playwrightRequest('demonstration',{op:args.op,tabId:args.tabId});
  if(args.op!=='stop')fail('browser_teach_action_invalid');
  const result=await service.playwrightRequest('demonstration',{op:'stop',tabId:args.tabId});
  const events=Array.isArray(result?.events)?result.events:[];
  // Values typed during the demonstration are captured here, in memory, while the card builder turns them into slots.
  const values={};
  const recorder={recordStep:(tool,input,view,outcome,slot)=>{const captured=recordStep(tool,input,view,outcome,slot);if(captured?.values)Object.assign(values,captured.values);return captured;},recordTarget};
  const first=events.find(event=>typeof event.url==='string');let route='about:blank';try{if(first){const url=new URL(first.url);route=url.origin+url.pathname;}}catch{route='about:blank';}
  const title=String(args.title||result?.title||'브라우저 절차').trim().slice(0,180)||'브라우저 절차';
  const built=events.length?demonstrationCard(events,{id:'teach-'+randomUUID().slice(0,8),title,wikiRef:{id:'workspace',version:1},recorder,route}):null;
  const card=built?portableTargets(built):null;
  const summary={tabId:result?.tabId??args.tabId,events:events.length,dropped:result?.dropped??0,reason:result?.reason??null,skipped:card?.demonstration?.skipped??0};
  if(!card)return {...summary,card:null,binding:null};
  const stepsHash=stepsHashOf(card),sessionId=randomUUID(),revision=stepsHash.replace(/^sha256:/,'').slice(0,16);
  const sessions=sessionsOf(service);
  sessions.set(sessionId,{sessionId,projectId:service.projectId,revision,stepsHash,tabId:summary.tabId,documentId:result?.documentId??null,card,values,runs:new Map(),saved:null,createdAt:Date.now()});
  while(sessions.size>SESSION_LIMIT)sessions.delete(sessions.keys().next().value);
  return {...summary,binding:{projectId:service.projectId,sessionId,revision},card,observation:null,capture:null};
}

async function trial(service,args){
  const found=session(service,args.binding),card=sameSteps(found,args.card);
  for(const input of card.inputs)if(found.values[input.slot]===undefined)fail('browser_teach_values_missing');
  const draftKey=typeof args.draftKey==='string'?args.draftKey.slice(0,200000):null;
  // The person confirmed this one run in the panel; the approval covers this session, these steps and no later run.
  const approval={kind:'trial_once',sessionId:found.sessionId,stepsHash:found.stepsHash,at:new Date().toISOString()};
  const outcome=await runBrowserCard(service,{card,values:found.values});
  let captures=[];
  if(outcome.tabId){
    const shot=await service.playwrightRequest('capture',{tabId:outcome.tabId,documentId:outcome.documentId,maxWidth:1280}).catch(()=>null);
    if(typeof shot?.image==='string'&&shot.image)captures=[{id:'capture:'+randomUUID(),dataUrl:'data:image/png;base64,'+shot.image,width:shot.width??null,height:shot.height??null,label:'실행 뒤 화면'}];
  }
  const receiptId='teach-run:'+randomUUID();
  found.runs.set(receiptId,{receiptId,at:approval.at,success:outcome.completed,steps:outcome.confirmedSteps,stopped:outcome.stopped,ms:outcome.ms,tabId:outcome.tabId,documentId:outcome.documentId,stepsHash:found.stepsHash,draftKey,captures,approval});
  return {binding:args.binding,draftKey,receiptId,success:outcome.completed,steps:outcome.confirmedSteps,stopped:outcome.stopped,ms:outcome.ms,captures:captures.map(({id,dataUrl,width,height,label})=>({id,dataUrl,width,height,label}))};
}

async function save(service,args){
  const found=session(service,args.binding),card=sameSteps(found,args.card);
  const draftKey=typeof args.draftKey==='string'?args.draftKey.slice(0,200000):null;
  const run=args.receiptId?found.runs.get(args.receiptId):null;
  if(args.receiptId&&(!run||run.stepsHash!==found.stepsHash))fail('browser_teach_receipt_missing');
  const workspace=await service.target(args.taskId);
  const slug=found.saved?.slug??await freeSlug(workspace,args.slug?safeScriptSlug(args.slug):scriptSlugFromTitle(card.title),found.stepsHash);
  const saved=await saveBrowserScript(workspace,{slug,card:{...card,status:'draft'},purpose:typeof args.purpose==='string'?args.purpose.slice(0,500):card.teach?.purpose||''});
  if(run&&!run.persisted){
    const {root,rel}=await scriptDir(workspace,slug);
    await mkdir(path.join(root,rel,'captures'),{recursive:true});
    const stamp=run.at.replace(/[:.]/g,'-');
    for(const [index,capture] of run.captures.entries()){
      const file=await scopedFile(root,`${rel}/captures/${stamp}-${String(index+1).padStart(2,'0')}.png`,{newFile:true});
      await writeFile(file,Buffer.from(capture.dataUrl.replace(/^data:image\/png;base64,/,''),'base64'));capture.file=path.relative(root,file);
    }
    await recordBrowserScriptRun(workspace,slug,{success:run.success,steps:run.steps,stopped:run.stopped,ms:run.ms,modelCalls:0});run.persisted=true;
  }
  found.saved={slug,version:saved.card.version,stepsHash:saved.card.stepsHash};
  return {binding:args.binding,draftKey,script:scriptView(saved.card)};
}

async function approve(service,args){
  const found=session(service,args.binding);
  const draftKey=typeof args.draftKey==='string'?args.draftKey.slice(0,200000):null;
  if(!found.saved)fail('browser_teach_script_missing');
  if(args.slug!==found.saved.slug||args.hash!==found.saved.stepsHash||args.version!==found.saved.version)fail('browser_teach_script_mismatch');
  const run=found.runs.get(args.receiptId);
  const inspected=Array.isArray(args.captureIds)?args.captureIds:[];
  // Evidence: a successful trial of these exact steps whose every capture the person looked at.
  if(!run||run.success!==true||run.stepsHash!==found.stepsHash||!run.captures.length||!run.captures.every(capture=>inspected.includes(capture.id)))fail('browser_teach_evidence_missing');
  const workspace=await service.target(args.taskId),{card}=await loadBrowserScript(workspace,found.saved.slug);
  if(card.stepsHash!==found.stepsHash||card.version!==found.saved.version)fail('browser_teach_script_mismatch');
  const reviewed=await reviewBrowserScript(workspace,found.saved.slug);
  return {binding:args.binding,draftKey,script:scriptView(reviewed)};
}

async function scriptDir(workspace,slug){
  const {realpath}=await import('node:fs/promises');
  const root=await realpath(workspace);return {root,rel:`${BROWSER_SCRIPTS_DIR}/${safeScriptSlug(slug)}`};
}
