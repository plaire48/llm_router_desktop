// Host-owned Wiki settings. Catalogs and credentials remain with the existing provider.
import {hasProjectWiki,requireProjectWiki} from './wiki-scope.mjs';
export const WIKI_GENERATION_DEFAULTS=Object.freeze({model:'auto',provider:null,effort:'auto',concurrency:3,maxToolCalls:8,pageMaxTokens:16384});
const invalid=()=>{throw Error('wiki_generation_invalid');};
export function normalizeWikiGeneration(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(WIKI_GENERATION_DEFAULTS,k)))invalid();
 const result={...WIKI_GENERATION_DEFAULTS,...value};
 if(typeof result.model!=='string'||!result.model||result.model.length>256||result.model!=='auto'&&(typeof result.provider!=='string'||!result.provider))invalid();
 if(!['auto','none','minimal','low','medium','high','xhigh','max'].includes(result.effort)||!Number.isInteger(result.concurrency)||result.concurrency<1||result.concurrency>4||![8,16].includes(result.maxToolCalls)||!Number.isInteger(result.pageMaxTokens)||result.pageMaxTokens<1024||result.pageMaxTokens>32768)invalid();
 if(result.model==='auto')result.provider=null;
 return result;
}
export function resolveWikiGeneration(service,value=service.store?.get('setting:wiki-generation')||{}){
 const settings=normalizeWikiGeneration(value),status=service.providers?.status?.()||{},catalogs=service.providers?.wikiModels?.();
 if(!catalogs){
  const applied=status.connected?{provider:status.provider,model:status.model,effort:status.reasoningEffort||null,concurrency:settings.concurrency,maxToolCalls:8,pageMaxTokens:null,selection:'current'}:null;
  return {settings,models:[],applied,request:null,connectionId:status.connectionId};
 }
 const models=catalogs.flatMap(c=>c.models.map(model=>({provider:c.provider,model:model.id,label:model.label||model.id,efforts:model.reasoningOptions||[],pageOutputConfigurable:model.pageOutputConfigurable!==false})));
 // A priority is accepted only from an explicit host table, never model names or window sizes.
 const preferred=(service.wikiModelPriority||[]).find(p=>models.some(m=>m.provider===p.provider&&m.model===p.model));
 const selected=settings.model==='auto'?(preferred||{provider:status.provider,model:status.model}):settings;
 const catalog=catalogs.find(c=>c.provider===selected.provider&&c.models.some(m=>m.id===selected.model));
 if(!catalog)return {settings,models,applied:null,request:null};
 // Automatic effort follows the reasoning chosen for the conversation (user decision 2026-10-23) when the wiki uses that
 // connection and its model offers that level; otherwise the provider default applies.
 // An automatic model can change under a saved explicit effort; one it lacks reads as automatic, as the reasoning chip shows.
 const efforts=models.find(m=>m.provider===selected.provider&&m.model===selected.model)?.efforts||[];
 const effort=settings.model==='auto'&&settings.effort!=='auto'&&!efforts.includes(settings.effort)?'auto':settings.effort;
 const conversationEffort=effort==='auto'&&selected.provider===status.provider&&efforts.includes(status.reasoningEffort)?status.reasoningEffort:null;
 const request=service.providers.wikiRequest({purpose:'wiki',provider:selected.provider,model:selected.model,connectionId:catalog.connectionId,effort:conversationEffort||effort,maxToolCalls:settings.maxToolCalls});
 const page=service.providers.wikiRequest({...request,maxTokens:settings.pageMaxTokens});
 return {settings,models,request,connectionId:request.connectionId,applied:{provider:request.provider,model:request.model,effort:request.effort,concurrency:settings.concurrency,maxToolCalls:request.maxToolCalls,pageMaxTokens:page.maxTokens,selection:settings.model==='auto'?(preferred?'priority':'current'):'explicit'}};
}
export function wikiGenerationBinding(service){const view=resolveWikiGeneration(service);return {...view.applied,connected:!!view.applied,request:view.request,connectionId:view.connectionId,settings:view.settings};}
export function assertWikiGenerationCurrent(service,binding){
 if(binding.request){try{service.providers.wikiRequest(binding.request);}catch{throw Error('provider_changed');}return;}
 const active=service.providers.status();if(!active.connected||active.model!==binding.model||active.provider!==binding.provider||active.connectionId!==binding.connectionId)throw Error('provider_changed');
}
export function wikiGeneration(service,{action='get',value}={}){
 service.ready();let view;
 if(!hasProjectWiki(service)){if(action!=='get')requireProjectWiki(service);return {available:false,reason:'personal_conversation',settings:null,models:[],applied:null};}
 if(action==='set'){if(service.wikiInitController||service.wikiInitAdmission||service.wikiUpdateRun||service.wikiRefreshOwner)throw Error('wiki_busy');view=resolveWikiGeneration(service,normalizeWikiGeneration(value));if(!view.applied)throw Error('model_unavailable');service.store.set('setting:wiki-generation',view.settings);}
 else if(action==='get')view=resolveWikiGeneration(service);else invalid();
 const {settings,models,applied}=view;return {settings,models,applied};
}
