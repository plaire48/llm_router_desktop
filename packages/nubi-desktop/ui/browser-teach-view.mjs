// Pure projection of the existing T4 module. No recorder, execution or storage ownership here.
import {draftPlan,questionsFor,applyAnswers,annotationBoard} from '../../nubi-browser-agent/src/teach.ts';
export const unnamedTeachInput=input=>!String(input.label||'').trim()||input.label==='입력값';
export function teachDraft(card,answers={},labels={}){
 const labeled={...card,inputs:(card.inputs||[]).map(input=>{
  const label=Object.hasOwn(labels,input.slot)&&typeof labels[input.slot]==='string'?labels[input.slot].trim().slice(0,80):'';
  return unnamedTeachInput(input)&&label?{...input,label}:input;
 })};
 const plan=draftPlan(labeled);plan.purpose=String(card.teach?.purpose||'').trim();
 plan.steps=plan.steps.map(step=>{
  const original=card.inputs?.find(input=>input.slot===step.slot),input=labeled.inputs.find(input=>input.slot===step.slot);
  if(!original||!unnamedTeachInput(original)||!input?.label)return step;
  const before='‘'+step.target+'’',after='‘'+input.label+'’';
  return {...step,target:input.label,summary:step.summary.replace(before,after),reason:step.reason.replace(before,after)};
 });
 return {plan,questions:questionsFor(plan),card:applyAnswers(labeled,plan,answers)};
}
export function bindingKey(binding){return JSON.stringify([binding?.projectId,binding?.sessionId,binding?.revision]);}
export function boardProjection(observation,capture){
 if(!observation?.observationId||capture?.observationId!==observation.observationId||!observation.binding?.tabId||capture.tabId!==observation.binding.tabId||!observation.binding.documentId||capture.documentId!==observation.binding.documentId)return [];
 const v=capture.viewport;if(!v||![v.x,v.y,v.width,v.height].every(Number.isFinite)||v.width<=0||v.height<=0)return [];
 return annotationBoard(observation).map(row=>{
  const b=row.box;let rect=null;
  if(b&&[b.x,b.y,b.width,b.height].every(Number.isFinite)&&b.width>0&&b.height>0){
   const x=Math.max(v.x,b.x),y=Math.max(v.y,b.y),right=Math.min(v.x+v.width,b.x+b.width),bottom=Math.min(v.y+v.height,b.y+b.height);
   if(right>x&&bottom>y)rect={left:(x-v.x)/v.width*100,top:(y-v.y)/v.height*100,width:(right-x)/v.width*100,height:(bottom-y)/v.height*100};
  }
  return {...row,rect};
 });
}
export function runMatches(run,binding,draftKey){return Boolean(binding?.projectId&&binding?.sessionId&&binding?.revision&&run?.binding&&bindingKey(run.binding)===bindingKey(binding)&&run.draftKey===draftKey);}
export function reviewable(run,binding,draftKey,inspected){return Boolean(runMatches(run,binding,draftKey)&&run.success===true&&run.receiptId&&run.captures?.length&&run.captures.every(c=>c.id&&inspected.includes(c.id)));}
