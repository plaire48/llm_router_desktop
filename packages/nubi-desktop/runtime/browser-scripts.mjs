// Saved browser scripts (browser teach plan T5, 2026-10-21): a procedure card the person demonstrated or the agent
// learned, kept in the Workspace as `.nubi/browser-scripts/<slug>/` with the card, a readable README and run
// receipts. The card holds slots and sources, never values. Status follows the procedure memory: draft (saved),
// reviewed (the person ran it and accepted), revalidated (three later successes), and any card change returns it
// to draft. Sharing later copies card.json and README.md; captures and runs stay local.
import {realpath,mkdir,readdir,writeFile,readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {scopedFile,hash,fail} from './files.mjs';

export const BROWSER_SCRIPTS_DIR='.nubi/browser-scripts';
// The procedure memory's forbidden keys plus a retained fill value and credential-like keys. Teach metadata may
// carry assert text; a literal value may not: only literal_pending is allowed in a card.
const FORBIDDEN_KEYS=new Set(['ref','targetId','observationId','documentId','actionId','ordinal','alike','selector','script','code','values','value','password','token','cookie']);
const SLUG=/^[a-z0-9가-힣][a-z0-9가-힣-]{0,60}$/;
const TOOLS=new Set(['fill_form','select_option','click_element','press_key','navigate_page','verify_page']);
const PROMOTION_SUCCESSES=3;

export const safeScriptSlug=slug=>{if(typeof slug!=='string'||!SLUG.test(slug))fail('browser_script_slug_invalid');return slug;};
const portable=value=>Array.isArray(value)?value.every(portable):value&&typeof value==='object'?Object.entries(value).every(([key,item])=>!FORBIDDEN_KEYS.has(key)&&portable(item)):true;
// The card is checked here the way the procedure memory checks it, so a saved script never carries a value.
export function validateBrowserScriptCard(card){
  if(!card||card.schemaVersion!==1||typeof card.title!=='string'||!card.title.trim()||card.title.length>180)fail('browser_script_card_invalid');
  if(!Array.isArray(card.steps)||!card.steps.length||card.steps.length>200||!Array.isArray(card.inputs))fail('browser_script_card_invalid');
  if(!card.steps.every(step=>step&&TOOLS.has(step.tool)))fail('browser_script_step_invalid');
  if(!portable({steps:card.steps,inputs:card.inputs,teach:card.teach??null}))fail('browser_script_value_retained');
  for(const meta of Object.values(card.teach?.steps??{}))if(meta?.valueSource&&meta.valueSource.kind==='literal')fail('browser_script_value_retained');
  for(const input of card.inputs)if(!input||typeof input.slot!=='string'||!/^v\d{1,3}$/.test(input.slot)||typeof input.label!=='string')fail('browser_script_card_invalid');
  if(JSON.stringify(card).length>64000)fail('browser_script_card_invalid');
  return card;
}
const stepLine=(step,index)=>{
  const name=target=>String(target?.name||target?.context?.[0]?.name||target?.role||'컨트롤').slice(0,60);
  const text=step.tool==='fill_form'?`‘${name(step.fields?.[0]?.target)}’ 칸에 값을 입력`:step.tool==='select_option'?`‘${name(step.target)}’에서 항목 선택`:step.tool==='press_key'?`‘${name(step.target)}’에서 ${step.args?.key??''} 키`:step.tool==='navigate_page'?`${step.page??''} 페이지로 이동`:step.tool==='verify_page'?'화면 확인':`‘${name(step.target)}’ 누르기`;
  return `${index+1}. ${text}`;
};
export function renderBrowserScriptReadme(card,{purpose='',preconditions=[]}={}){
  const teach=card.teach||{},lines=[`# ${card.title}`,'',`목적: ${purpose||teach.purpose||card.title}`,'',
    '선행 조건: '+(preconditions.length?preconditions.join(', '):'대상 사이트에 로그인된 상태. 로그인은 사람이 한다.'),'',
    '## 단계',...card.steps.map((step,index)=>{const meta=teach.steps?.[String(index)];return stepLine(step,index)+(meta?.reason?` — ${meta.reason}`:'')+(meta?.guard?' (확인 필요)':'');}),'',
    '## 입력',...(card.inputs.length?card.inputs.map(input=>{const source=Object.values(teach.steps||{}).find(meta=>meta?.slot===input.slot)?.valueSource;return `- ${input.label} (${input.slot}): ${source?.kind==='mail'?'메일에서':source?.kind==='wiki'?'위키에서':source?.kind==='literal_pending'?'고정값(실행 설정에 저장)':'실행 때 묻기'}`;}):['- 없음']),'',
    `상태: ${card.status}. 값은 이 파일과 card.json에 저장하지 않는다.`,''];
  return lines.join('\n');
}
async function scriptDir(projectRoot,slug,{create=false}={}){
  safeScriptSlug(slug);const root=await realpath(projectRoot),rel=`${BROWSER_SCRIPTS_DIR}/${slug}`;
  if(create){await mkdir(path.join(root,BROWSER_SCRIPTS_DIR),{recursive:true});await mkdir(path.join(root,rel),{recursive:true});}
  const dir=await scopedFile(root,rel);const stat=await lstat(dir);if(!stat.isDirectory())fail('browser_script_missing');
  return {root,rel,dir};
}
export async function saveBrowserScript(projectRoot,{slug,card,purpose='',preconditions=[]}){
  validateBrowserScriptCard(card);
  const {root,rel}=await scriptDir(projectRoot,slug,{create:true});
  const previous=await loadBrowserScript(projectRoot,slug).catch(error=>{if(error.message==='browser_script_missing')return null;throw error;});
  const stepsHash=hash(JSON.stringify(card.steps));
  // A changed card goes back to draft; an unchanged one keeps its status and version.
  const status=previous&&previous.card.stepsHash===stepsHash?previous.card.status:'draft';
  const version=previous?(previous.card.stepsHash===stepsHash?previous.card.version:previous.card.version+1):1;
  const saved={...card,id:slug,version,status,stepsHash,savedAt:new Date().toISOString()};
  const readme=renderBrowserScriptReadme(saved,{purpose,preconditions});
  await writeFile(await scopedFile(root,`${rel}/card.json`,{newFile:true}),JSON.stringify(saved,null,1)+'\n');
  await writeFile(await scopedFile(root,`${rel}/README.md`,{newFile:true}),readme);
  await mkdir(path.join(root,rel,'runs'),{recursive:true});await mkdir(path.join(root,rel,'captures'),{recursive:true});
  return {slug,card:saved,readme,hash:hash(JSON.stringify(saved))};
}
export async function loadBrowserScript(projectRoot,slug){
  const {root,rel}=await scriptDir(projectRoot,slug).catch(error=>{if(error.code==='ENOENT')fail('browser_script_missing');throw error;});
  let text;try{text=await readFile(await scopedFile(root,`${rel}/card.json`),'utf8');}catch(error){if(error.code==='ENOENT')fail('browser_script_missing');throw error;}
  let card;try{card=JSON.parse(text);}catch{fail('browser_script_card_invalid');}
  validateBrowserScriptCard(card);
  const readme=await readFile(await scopedFile(root,`${rel}/README.md`),'utf8').catch(()=>'');
  return {slug,card,readme,hash:hash(JSON.stringify(card)),runs:await listRuns(root,rel)};
}
async function listRuns(root,rel){
  let names=[];try{names=await readdir(path.join(root,rel,'runs'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const runs=[];for(const name of names.filter(n=>n.endsWith('.json')).sort().slice(-50)){try{runs.push(JSON.parse(await readFile(path.join(root,rel,'runs',name),'utf8')));}catch{/* An unreadable receipt is skipped, never fatal. */}}
  return runs;
}
export async function listBrowserScripts(projectRoot){
  const root=await realpath(projectRoot);let names=[];
  try{names=(await readdir(path.join(root,BROWSER_SCRIPTS_DIR),{withFileTypes:true})).filter(e=>e.isDirectory()&&SLUG.test(e.name)).map(e=>e.name);}catch(error){if(error.code!=='ENOENT')throw error;}
  const scripts=[];for(const slug of names.sort()){try{const {card,runs}=await loadBrowserScript(projectRoot,slug);scripts.push({slug,title:card.title,status:card.status,version:card.version,steps:card.steps.length,inputs:card.inputs.length,runs:runs.length,lastRunAt:runs.at(-1)?.at??null});}catch{/* A broken folder is listed nowhere; the user sees it in the file tree. */}}
  return scripts;
}
/** The person ran the script and accepted the result: draft → reviewed. */
export async function reviewBrowserScript(projectRoot,slug){
  const {root,rel}=await scriptDir(projectRoot,slug);const {card}=await loadBrowserScript(projectRoot,slug);
  if(card.status!=='draft')return card;
  const reviewed={...card,status:'reviewed',reviewedAt:new Date().toISOString()};
  await writeFile(await scopedFile(root,`${rel}/card.json`),JSON.stringify(reviewed,null,1)+'\n');return reviewed;
}
/** A run receipt: typed facts only. Three successes after review promote the card to revalidated. */
export async function recordBrowserScriptRun(projectRoot,slug,run){
  const {root,rel}=await scriptDir(projectRoot,slug);const {card,runs}=await loadBrowserScript(projectRoot,slug);
  const receipt={at:new Date().toISOString(),success:run?.success===true,ms:Number.isSafeInteger(run?.ms)?run.ms:null,steps:Number.isSafeInteger(run?.steps)?run.steps:null,toolCalls:Number.isSafeInteger(run?.toolCalls)?run.toolCalls:null,stopped:typeof run?.stopped==='string'?run.stopped.slice(0,200):null,modelCalls:Number.isSafeInteger(run?.modelCalls)?run.modelCalls:0,cardVersion:card.version};
  await mkdir(path.join(root,rel,'runs'),{recursive:true});
  // Two receipts in the same millisecond must not share a file name.
  await writeFile(await scopedFile(root,`${rel}/runs/${receipt.at.replace(/[:.]/g,'-')}-${String(runs.length+1).padStart(4,'0')}.json`,{newFile:true}),JSON.stringify(receipt,null,1)+'\n');
  let status=card.status;
  if(status==='reviewed'){const recent=[...runs,receipt].filter(r=>r.cardVersion===card.version);const streak=recent.slice(-PROMOTION_SUCCESSES);if(streak.length===PROMOTION_SUCCESSES&&streak.every(r=>r.success))status='revalidated';}
  if(status!==card.status)await writeFile(await scopedFile(root,`${rel}/card.json`),JSON.stringify({...card,status,promotedAt:new Date().toISOString()},null,1)+'\n');
  return {receipt,status};
}
