import {runReplay,recordTarget,matchTarget} from '../../../extensions/aipro-chat/browser-replay.js';
const invalid=code=>{throw Error('development_workflow_'+code);};
export const WORKFLOW_TOOL={name:'browser_run_workflow',description:'Run 1-8 exact approved actions on controls already observed in one top-frame page. Uses fresh semantic matching and durable per-action BrowserSession receipts, without model calls between steps. Stop on changed/ambiguous targets; never repeat a confirmed prefix. No scripts, navigation, iframe or credential automation.',inputSchema:{type:'object',additionalProperties:false,properties:{tabId:{type:'string'},documentId:{type:'string'},steps:{type:'array',minItems:1,maxItems:8,items:{type:'object',additionalProperties:false,properties:{action:{enum:['type','click']},target:{type:'string',maxLength:120},text:{type:'string',maxLength:2000},key:{type:'string',maxLength:80}},required:['action','target']}}},required:['tabId','documentId','steps']},annotations:{readOnlyHint:false}};
function view(text){
 if(typeof text!=='string'||/자 생략|tokens truncated|snapshot truncated|^\s*-\s*(?:iframe|frame)\b/im.test(text))invalid('observation');
 const elements=[];
 for(const line of text.split('\n')){
  const match=/^\s*-\s*(textbox|searchbox|button|link|checkbox|radio|combobox|menuitem|tab)\s+("(?:[^"\\]|\\.)*")[^\n]*?\[ref=([^\]]+)\]/.exec(line);
  if(!match)continue;
  let name;try{name=JSON.parse(match[2]);}catch{invalid('observation');}
  elements.push({ref:match[3],role:match[1],name,kind:['textbox','searchbox','combobox'].includes(match[1])?'field':'control',tag:'',...(/\[(?:disabled|readonly)\]/.test(line)?{coveredBy:'disabled'}:{})});
 }
 if(!elements.length||new Set(elements.map(x=>x.ref)).size!==elements.length)invalid('observation');
 return {frames:[{frame:0,elements}]};
}
export function prepareWorkflow(text,input){
 if(!Array.isArray(input.steps)||input.steps.length<1||input.steps.length>8)invalid('invalid');
 const observation=view(text),values={};
 const steps=input.steps.map((step,index)=>{
  if(!step||!['type','click'].includes(step.action)||typeof step.target!=='string'||Object.keys(step).some(key=>!['action','target','text','key'].includes(key)))invalid('invalid');
  const element=observation.frames[0].elements.find(x=>x.ref===step.target);if(!element||!element.name)invalid('target');
  const target=recordTarget(element,observation);delete target.ordinal;delete target.alike;
  if(matchTarget(target,observation).element?.ref!==step.target)invalid('target');
  if(step.action==='type'){
   if(!['textbox','searchbox'].includes(element.role)||typeof step.text!=='string'||step.text.length>2000||step.key!==undefined)invalid('invalid');
   const slot='value'+index;values[slot]=step.text;return {tool:'fill_form',fields:[{target,slot}]};
  }
  if(step.text!==undefined)invalid('invalid');
  if(step.key!==undefined)invalid('invalid');return {tool:'click_element',target};
 });
 return {steps,values};
}
export async function runWorkflow(plan,{observe,act,signal,onConfirmed=()=>{}}){
 let confirmedSteps=0,lastText='';
 const result=await runReplay(plan,{signal,executeTool:async(name,args)=>{
  signal?.throwIfAborted();
  if(name==='browser_snapshot'){lastText=await observe();return {observation:view(lastText)};}
  const field=name==='fill_form'?args.fields[0]:null;
  const tool=name==='fill_form'?'browser_type':name==='press_key'?'browser_press_key':'browser_click';
  const outcome=await act(tool,{target:field?.field_id||args.ref,...(field?{text:field.value}:name==='press_key'?{key:args.key}:{})});
  if(!outcome.ok)return {ok:false,error:outcome.execution==='unconfirmed'?'execution_unconfirmed':'workflow_action_failed'};
  confirmedSteps++;await onConfirmed(confirmedSteps);lastText=outcome.text;
  try{return {observation:view(lastText)};}catch{return {ok:false,error:'workflow_observation_changed'};}
 }});
 return {...result,confirmedSteps,text:lastText,taskCompleted:false};
}
