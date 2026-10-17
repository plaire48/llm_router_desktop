import {createScreenKnowledge,createModelScreenAnalyzer,screenKnowledgeText} from '../generated/browser-screen-knowledge.mjs';
import {createWikiScreenStore} from '../generated/browser-screen-wiki.mjs';
import {createScreenLearning} from '../generated/browser-screen-learning.mjs';
import {hash} from './files.mjs';
// Only structural labels from the currently authorized snapshot. Never retain
// field values, page bodies, cookies or a past ref as an executable target.
export function screenEvidence(text){
 if(typeof text!=='string'||/snapshot truncated|tokens truncated|자 생략|^\s*-\s*(?:iframe|frame)\b/im.test(text))throw Error('screen_observation_partial');
 const facts=[];
 for(const line of text.split('\n')){
  const match=/^\s*-\s*(heading|textbox|searchbox|combobox|button|checkbox|radio|menuitem|tab)\s+("(?:[^"\\]|\\.)*")/.exec(line);if(!match)continue;
  let label;try{label=JSON.parse(match[2]);}catch{continue;}
  if(/password|비밀번호|인증번호|one.?time|otp|verification code/i.test(label))throw Error('screen_auth_protected');
  if(!label.trim()||label.length>240)continue;
  facts.push({id:'f'+facts.length,kind:match[1]==='heading'?'heading':['textbox','searchbox','combobox'].includes(match[1])?'field':'action',text:label,context:match[1]});
  if(facts.length>64)throw Error('screen_observation_partial');
 }
 if(!facts.some(f=>f.kind==='heading')||facts.length<2)throw Error('screen_structure_unavailable');
 const fingerprint=hash(JSON.stringify(facts));return {screenId:'screen-'+fingerprint.slice(7,39),variantId:'default',fingerprint,observedAt:new Date().toISOString(),facts,coverage:{partial:true,frames:1}};
}
function screenOptions(service,{preview,text,evidence:provided,validate,complete,learning=false,shared=false}){
 const scope={projectId:service.projectId,systemId:'web-'+hash(new URL(preview.url).origin).slice(7,39),environmentId:'workspace',accessScopeId:shared?'structure-'+preview.knowledgeScope:'tab-'+hash(preview.knowledgeScope?JSON.stringify([preview.tabId,preview.knowledgeScope]):preview.tabId).slice(7,39)},evidence=provided||screenEvidence(text),prefix='browser-screen-wiki:',store=service.store;
 const documents={read:async path=>store.get(prefix+path)||null,compareAndSet:async(path,_scope,version,content,signal)=>{signal.throwIfAborted();if(service.disposed||service.projectId!==scope.projectId||service.store!==store)return false;const previous=store.get(prefix+path);if((previous?.version??null)!==version)return false;store.set(prefix+path,{version:hash(content),content});return true;}};
 return {scope,source:{observe:async()=>evidence,validate:async(_e,signal)=>validate(signal)},store:createWikiScreenStore(documents),analyzer:createModelScreenAnalyzer({id:service.providers?.status().model||'host',complete:(messages,tools,context)=>complete(messages,tools,context.signal)},{learning})};
}
function withStructuralReuse(service,options,primary){
 const scoped=typeof options.preview.knowledgeScope==='string'&&/^[a-f0-9-]{36}$/.test(options.preview.knowledgeScope);
 const shared=scoped?screenOptions(service,{...options,shared:true}):null;
 const publish=async signal=>{if(!shared)return;const found=await primary.recall(signal);if(found.status!=='matched')return;const {questions,...analysis}=found.record.analysis;
  // Only observed labels and grounded structure may cross tabs. Never answers,
  // procedures, DOM targets, field values or account-specific explanations.
  await createScreenKnowledge({...shared,analyzer:{id:'host-structural-copy',analyze:async()=>structuredClone(analysis)}}).analyzeAndSave(signal);
 };
 return {...primary,publishStructure:publish,async analyzeAndSave(signal,args){const result=await primary.analyzeAndSave(signal,args);await publish(signal);return result;},async recall(signal){const local=await primary.recall(signal);if(local.status==='matched'||!shared)return local;const other=await createScreenKnowledge(shared).recall(signal);return other.status==='matched'?{...other,scope:'same_session_structure_only'}:local;}};
}
export function workspaceScreenKnowledge(service,options){return withStructuralReuse(service,options,createScreenKnowledge(screenOptions(service,options)));}
export function workspaceScreenLearning(service,options){const result=createScreenLearning({...screenOptions(service,{...options,learning:true}),validateContext:options.validateContext,allowAnswer:options.allowAnswer});return {...result,knowledge:withStructuralReuse(service,options,result.knowledge)};}
export {screenKnowledgeText};
