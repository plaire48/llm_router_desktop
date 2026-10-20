// Pure projection of the existing T4 module. No recorder, execution or storage ownership here.
import {draftPlan,questionsFor,applyAnswers,annotationBoard} from '../../nubi-browser-agent/src/teach.ts';
export function teachDraft(card,answers={}){
 const plan=draftPlan(card);return {plan,questions:questionsFor(plan),card:applyAnswers(card,plan,answers)};
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
