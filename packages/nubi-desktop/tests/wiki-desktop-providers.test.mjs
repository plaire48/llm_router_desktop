import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopProviders} from '../runtime/desktop-providers.mjs';
const catalog=[{value:'sonnet',resolvedModel:'synthetic-sonnet',displayName:'Synthetic Sonnet',supportsEffort:true,supportedEffortLevels:['low','medium','high']},{value:'opus',resolvedModel:'synthetic-opus',displayName:'Synthetic Opus',supportsEffort:true,supportedEffortLevels:['low','high']}];
const tool={type:'function',function:{name:'read_source',parameters:{type:'object',properties:{},additionalProperties:false}}};
async function setup(t,count=0){
 const native=[],wire=[];const p=createDesktopProviders({findBinary:async()=>'/synthetic/claude',run:async(_,args,options={})=>{
 if(args[0]==='--help')return '--safe-mode --json-schema';if(args[0]==='auth')return JSON.stringify({loggedIn:true});if(args.includes('--input-format')){options.onEvent({type:'control_response',response:{subtype:'success',request_id:JSON.parse(options.input).request_id,response:{models:catalog}}});return '';}
 native.push(args);options.onEvent({type:'result',subtype:'success',structured_output:{content:'synthetic',calls:Array.from({length:count},()=>({name:'read_source',arguments:{}}))}});return '';
 },startLogin:async()=>({result:Promise.resolve({token:'synthetic',models:[{id:'synthetic-api',label:'Synthetic API'}]}),cancel(){}}),fetchImpl:async(_,request)=>{wire.push(JSON.parse(request.body));return Response.json({choices:[{message:{content:'API result'},finish_reason:'stop'}]});}});
 t.after(()=>p.dispose());await p.login('aipro');await new Promise(r=>setImmediate(r));await p.connect({provider:'claude'});return {p,native,wire};
}
const request=(p,provider,model)=>({purpose:'wiki',provider,model,connectionId:p.status().providers.find(p=>p.id===provider).connectionId,effort:'auto',maxToolCalls:8,maxTokens:16384});
const complete=(p,options)=>p.complete([{role:'user',content:'Synthetic wiki'}],[tool],new AbortController().signal,()=>{},()=>{},()=>{},options);
test('desktop wiki catalogs retain the existing Claude provider and bind server output default',async t=>{const {p}=await setup(t);const view=p.wikiModels().find(c=>c.provider==='claude');assert(view);assert.equal(view.models.length,2);assert.equal(view.models[0].pageOutputConfigurable,false);const {resolveWikiGeneration}=await import('../runtime/wiki-generation.mjs');const settings=resolveWikiGeneration({providers:p,store:{get:()=>null}});assert.equal(settings.applied.provider,'claude');assert.equal(settings.applied.pageMaxTokens,null);const resolved=p.wikiRequest(request(p,'claude','synthetic-opus'));assert.equal(resolved.effort,'high');assert.equal(resolved.maxTokens,null);});
test('a wiki API request keeps its provider while the conversation uses Claude',async t=>{const {p,native,wire}=await setup(t);const result=await complete(p,request(p,'aipro','synthetic-api'));assert.equal(result.content,'API result');assert.equal(wire.length,1);assert.equal(native.length,0);assert.equal(p.status().provider,'claude');});
test('a wiki Claude request uses its temporary model and effort while the conversation uses API',async t=>{const {p,native,wire}=await setup(t);await p.select('aipro');const result=await complete(p,request(p,'claude','synthetic-opus'));const args=native[0];assert.equal(args[args.indexOf('--model')+1],'synthetic-opus');assert.equal(args[args.indexOf('--effort')+1],'high');assert.equal(wire.length,0);assert.equal(result.requestOptions.maxTokens,null);assert.equal(p.status().provider,'aipro');await p.select('claude');assert.equal(p.status().model,'synthetic-sonnet');assert.equal(p.status().reasoningEffort,'medium');});
test('Claude wiki eight-call guard rejects nine and sixteen permits them without executing CLI tools',async t=>{const {p,native}=await setup(t,9);const options=request(p,'claude','synthetic-opus');await assert.rejects(complete(p,options),/response_invalid/);const result=await complete(p,{...options,maxToolCalls:16});assert.equal(result.calls.length,9);assert(native.every(args=>args.includes('--safe-mode')&&args[args.indexOf('--tools')+1]===''));});
test('stale Claude bindings and unsupported explicit effort fail before a CLI model call',async t=>{const {p,native}=await setup(t);const options=request(p,'claude','synthetic-opus');for(const patch of [{connectionId:'stale'},{model:'missing'},{effort:'xhigh'},{maxToolCalls:17}])await assert.rejects(complete(p,{...options,...patch}));assert.equal(native.length,0);});
test('automatic wiki effort follows the reasoning chosen for the conversation model it uses (user decision 2026-10-23)',async t=>{
 const {resolveWikiGeneration}=await import('../runtime/wiki-generation.mjs');
 const {p}=await setup(t);await p.select('claude');await p.reasoning('low');
 const service=settings=>({providers:p,store:{get:()=>settings}});
 assert.equal(resolveWikiGeneration(service({})).applied.effort,'low','automatic model and effort: the conversation pair');
 assert.equal(resolveWikiGeneration(service({model:'synthetic-sonnet',provider:'claude',effort:'auto'})).applied.effort,'low','same model chosen explicitly');
 assert.equal(resolveWikiGeneration(service({model:'synthetic-sonnet',provider:'claude',effort:'medium'})).applied.effort,'medium','an explicit wiki effort wins');
 assert.equal(resolveWikiGeneration(service({model:'synthetic-opus',provider:'claude',effort:'auto'})).applied.effort,'low','another model of the same connection keeps the chosen effort when it supports it');
 await p.reasoning('medium');assert.equal(resolveWikiGeneration(service({model:'synthetic-opus',provider:'claude',effort:'auto'})).applied.effort,'high','an effort the wiki model lacks falls back to the provider default');
});
test('an automatic wiki model whose conversation model lacks the saved effort uses the automatic effort instead of failing',async t=>{
 const {resolveWikiGeneration}=await import('../runtime/wiki-generation.mjs');
 const {p}=await setup(t);await p.select('claude');await p.reasoning('low');
 const view=resolveWikiGeneration({providers:p,store:{get:()=>({model:'auto',effort:'max'})}});
 assert.equal(view.applied.effort,'low','the conversation model has no max, so the chip shows 자동 and the wiki follows it');
});
