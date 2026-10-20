/** Optional draft review coordinator. The host owns rendering, model, policy and storage. */
import {abortable,canonical,clone,fail,fingerprint} from './contracts.js';
import {validateComposition,reviseComposition,assertPreservedComposition} from './composition.js';
import type {CompositionDomain,CompositionPlan,CompositionData} from './composition.js';
import type {AgentTransport,Json} from './types.js';
export type QualityGate='structure'|'facts'|'preservation'|'render'|'layout'|'visual'|'calculation';
export interface QualityFinding {code:string;kind:QualityGate;severity:'major'|'minor';path:string;message:string}
export interface QualityCheck {kind:QualityGate;status:'passed'|'failed'|'not_checked';evidence:string}
export interface QualityPages {count:number;rendered:Array<{page:number;imageHash:string}>;reviewed:number[]}
export interface QualityCandidate {domain:CompositionDomain;plan:CompositionPlan;bytes:Uint8Array;artifactHash:string;planHash:string}
export interface QualityReceipt {artifactHash:string;planHash:string;checks:QualityCheck[];pages?:QualityPages;findings:QualityFinding[]}
export interface QualityInput {domain:CompositionDomain;plan:CompositionPlan;request:string;sources:Json;datasets?:CompositionData;maxRepairs?:number;preservePaths?:string[]}
export interface QualityPorts {
 build(input:{domain:CompositionDomain;plan:CompositionPlan;signal:AbortSignal}):Promise<{bytes:Uint8Array}>;
 inspect(input:{candidate:QualityCandidate;layoutHints:QualityFinding[];signal:AbortSignal}):Promise<QualityReceipt>;
 transport?:AgentTransport;
 onRound?:(round:QualityRound)=>void;
}
export interface QualityRound {round:number;artifactHash:string;planHash:string;checks:QualityCheck[];findings:QualityFinding[];pages?:QualityPages;complete:boolean}
export type QualityStatus='verified_draft'|'needs_review'|'repair_limit'|'stalled'|'repair_regression';
export interface QualityResult {status:QualityStatus;candidate:QualityCandidate;rounds:QualityRound[];repairs:number;savedToOffice:false}
const gates:QualityGate[]=['structure','facts','preservation','render','layout','visual','calculation'];
const hashPattern=/^[a-f0-9]{64}$/;
const sha=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const cancelled=(signal:AbortSignal)=>{if(signal.aborted)fail('operation_cancelled');};
const copy=(candidate:QualityCandidate):QualityCandidate=>({...candidate,plan:clone(candidate.plan),bytes:candidate.bytes.slice()});
const pathValid=(path:unknown):path is string=>typeof path==='string'&&/^\/(blocks|slides|sheets|outputs|title|header|footer)(?:\/(?:[^~\/]|~[01])+)*$/.test(path)&&path.length<=240;
function textLines(text:string,width:number,size:number):number{
 let lines=1,line=0;
 for(const c of text){if(c==='\n'){lines++;line=0;continue;}const advance=size*(c.charCodeAt(0)>255?1:.55);if(line+advance>width&&line>0){lines++;line=0;}line+=advance;}
 return lines;
}
/** Estimates are actionable hints, not proof of actual font layout or visual quality. */
export function inspectCompositionQuality(domain:CompositionDomain,plan:CompositionPlan):QualityFinding[]{
 validateComposition(domain,plan);if(domain!=='powerpoint')return[];
 const findings:QualityFinding[]=[];
 for(const [i,slide]of plan.slides.entries()){
  for(const [j,e]of slide.elements.entries()){
   const path=`/slides/${i}/elements/${j}`;
   if((e.kind==='text'||e.kind==='shape')&&e.text){
    const lines=textLines(e.text,e.w*72,e.fontSize),height=lines*e.fontSize*1.18;
    if(height>e.h*72+1)findings.push({kind:'layout',code:'text_fit',severity:'major',path,message:`Estimated ${lines} lines need ${(height/72).toFixed(2)} inches; observed box height is ${e.h}. Enlarge or split content without dropping facts.`});
    if(e.fontSize<18)findings.push({kind:'layout',code:'small_text',severity:'major',path,message:'Text is below 18pt. Reflow content before reducing readability.'});
   }
   if(e.kind==='table'){
    const rowHeight=[e.headers,...e.rows].reduce((height:number,row:string[])=>height+Math.max(...row.map(t=>textLines(t,e.w*72/row.length-10,e.fontSize)))*e.fontSize*1.25+8,0);
    if(rowHeight>e.h*72+1)findings.push({kind:'layout',code:'table_fit',severity:'major',path,message:`Estimated wrapped table needs ${(rowHeight/72).toFixed(2)} inches; observed height is ${e.h}. Split the table or redistribute column space.`});
   }
  }
  const visible=slide.elements.map((e:any,index:number)=>({...e,index})).filter((e:any)=>e.kind!=='shape'||e.text);
  for(let a=0;a<visible.length;a++)for(let b=a+1;b<visible.length;b++){
   const x=visible[a],y=visible[b],w=Math.min(x.x+x.w,y.x+y.w)-Math.max(x.x,y.x),h=Math.min(x.y+x.h,y.y+y.h)-Math.max(x.y,y.y);
   if(w>.02&&h>.02&&w*h/Math.min(x.w*x.h,y.w*y.h)>.12)findings.push({kind:'layout',code:'object_overlap',severity:'major',path:`/slides/${i}`,message:`Objects ${x.index} and ${y.index} overlap. Inspect the rendered slide and move or resize affected objects without losing content.`});
  }
 }
 return findings.slice(0,48);
}
function checkedReceipt(receipt:QualityReceipt,c:QualityCandidate,round:number):QualityRound{
 if(!receipt||receipt.artifactHash!==c.artifactHash||receipt.planHash!==c.planHash)fail('quality_receipt_stale');
 if(canonical(receipt).length>80_000||!Array.isArray(receipt.checks)||receipt.checks.length>gates.length||!Array.isArray(receipt.findings)||receipt.findings.length>48)fail('quality_receipt_invalid');
 const observed=new Map<QualityGate,QualityCheck>();
 for(const check of receipt.checks){if(!gates.includes(check.kind)||observed.has(check.kind)||!['passed','failed','not_checked'].includes(check.status)||typeof check.evidence!=='string'||!check.evidence.trim()||check.evidence.length>2000)fail('quality_receipt_invalid');observed.set(check.kind,clone(check));}
 for(const f of receipt.findings){if(!gates.includes(f.kind)||!['major','minor'].includes(f.severity)||!pathValid(f.path)||!/^\w{1,80}$/.test(f.code)||typeof f.message!=='string'||!f.message.trim()||f.message.length>1600)fail('quality_receipt_invalid');}
 const required=gates.filter(g=>g!=='calculation'||c.domain==='excel');
 const checks=required.map(kind=>{const check=observed.get(kind)??{kind,status:'not_checked' as const,evidence:'The host did not supply this check.'};return receipt.findings.some(f=>f.kind===kind&&f.severity==='major')?{...check,status:'failed' as const}:check;});
 const pages=receipt.pages;
 let completePages=false;
 if(pages){
  if(!Number.isInteger(pages.count)||pages.count<1||pages.count>200||!Array.isArray(pages.rendered)||!Array.isArray(pages.reviewed)||pages.rendered.length>200||pages.reviewed.length>200)fail('quality_receipt_invalid');
  const rendered=new Set<number>(),reviewed=new Set<number>();
  for(const p of pages.rendered){if(!Number.isInteger(p.page)||p.page<1||p.page>pages.count||!hashPattern.test(p.imageHash)||rendered.has(p.page))fail('quality_receipt_invalid');rendered.add(p.page);}
  for(const p of pages.reviewed){if(!Number.isInteger(p)||p<1||p>pages.count||reviewed.has(p)||!rendered.has(p))fail('quality_receipt_invalid');reviewed.add(p);}
  completePages=rendered.size===pages.count&&reviewed.size===pages.count&&(c.domain!=='powerpoint'||pages.count===c.plan.slides.length);
 }
 if(!completePages)for(const check of checks)if(check.kind==='render'||check.kind==='visual')check.status='not_checked';
 return {round,artifactHash:c.artifactHash,planHash:c.planHash,checks,findings:clone(receipt.findings),...(pages?{pages:clone(pages)}:{}),complete:checks.every(c=>c.status==='passed')&&!receipt.findings.some(f=>f.severity==='major')};
}
/** Bounded private-draft coordinator; composes the existing GenOffice planning loop. */
export async function runCompositionQuality(input:QualityInput,ports:QualityPorts,signal:AbortSignal):Promise<QualityResult>{
 cancelled(signal);const domain=input.domain,request=input.request;validateComposition(domain,input.plan);
 const preservePaths=input.preservePaths===undefined?undefined:clone(input.preservePaths);assertPreservedComposition(input.plan,input.plan,preservePaths);
 const max=input.maxRepairs??2;
 if(!Number.isInteger(max)||max<0||max>3||typeof request!=='string'||!request.trim()||request.length>14000||canonical(input.sources).length>70_000||typeof ports?.build!=='function'||typeof ports?.inspect!=='function')fail('quality_input_invalid');
 const source=clone(input.sources),datasets=input.datasets?clone(input.datasets):undefined,rounds:QualityRound[]=[],seen=new Set<string>();let plan=clone(input.plan),candidate:QualityCandidate|undefined,previous:QualityCandidate|undefined,previousRound:QualityRound|undefined;
 const result=(status:QualityStatus,chosen=candidate!):QualityResult=>({status,candidate:copy(chosen),rounds:clone(rounds),repairs:Math.max(0,rounds.length-1),savedToOffice:false});
 for(let round=0;round<=max;round++){
  cancelled(signal);const planHash=await fingerprint(plan);if(seen.has(planHash))return result('stalled');seen.add(planHash);
  const buildPlan=clone(plan),built=await abortable(ports.build({domain:domain,plan:buildPlan,signal}),signal);cancelled(signal);
  if(await fingerprint(buildPlan)!==planHash||!(built?.bytes instanceof Uint8Array)||!built.bytes.length||built.bytes.length>50_000_000)fail('quality_build_invalid');
  candidate={domain:domain,plan:clone(plan),bytes:built.bytes.slice(),planHash,artifactHash:await sha(built.bytes)};
  const observed=copy(candidate),receipt=await abortable(ports.inspect({candidate:observed,layoutHints:inspectCompositionQuality(domain,plan),signal}),signal);cancelled(signal);
  if(await fingerprint(observed.plan)!==planHash||await sha(observed.bytes)!==candidate.artifactHash)fail('quality_observation_changed');
  const review=checkedReceipt(receipt,candidate,round);rounds.push(review);try{ports.onRound?.(clone(review));}catch{}
  if(previousRound&&previousRound.checks.some(old=>old.status==='passed'&&review.checks.find(c=>c.kind===old.kind)?.status!=='passed'))return result('repair_regression',previous);
  if(review.complete)return result('verified_draft');
  // Incomplete verification is a host follow-up, never a model-repair success.
  if(review.checks.some(c=>c.status==='not_checked'))return result('needs_review');
  const actionable=review.findings.filter(f=>f.severity==='major'||review.checks.some(c=>c.kind===f.kind&&c.status==='failed'));if(!actionable.length||!ports.transport)return result('needs_review');
  if(round===max)return result('repair_limit');
  previous=copy(candidate);previousRound=clone(review);const allowedPaths=[...new Set(review.findings.map(f=>f.path))];let rejectedReason='';
  const revision=await reviseComposition(domain,{request:request+'\nRepair only the observed findings. Keep source data, required facts and unaffected content. Other documents exist or succeeded only when the host supplies their current receipts. Never infer pipeline status. No saving or publication is authorized.',plan:clone(plan),sources:{original:source,actualVerification:{checks:review.checks,findings:review.findings}} as unknown as Json,datasets},ports.transport,signal,{allowedPaths,preservePaths,onRejectedDraft:(_draft,reason)=>{rejectedReason=reason;}}).catch(error=>{if(rejectedReason==='quality_repair_scope')fail('quality_repair_scope');throw error;});cancelled(signal);
  for(const patch of revision.patches)if(!allowedPaths.some(path=>patch.path===path||patch.path.startsWith(path+'/')))fail('quality_repair_scope');
  plan=clone(revision.plan);
 }
 return result('repair_limit');
}
