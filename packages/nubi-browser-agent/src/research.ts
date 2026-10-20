import type {Action,Binding,BrowserPort,ExecutionResult,Json,JsonObject,Observation,OperationContext,Tool} from './types.js';
import {bindingEqual,BrowserAgentError,clone,fail} from './contracts.js';
import type {BrowserMemoryPort} from './memory.js';

export interface ObservedDocumentLink {linkId:string;title:string;url:string}
export interface DocumentEvidence {sourceId:string;url:string;title:string;text:string;truncated:boolean;observedAt:string;contentHash:string;selection?:{kind:'full'|'headings';headings:string[];missing:string[]}}
export interface DocumentReadHost {
  /** Capture only links in host-authorized roots. IDs are scoped to this exact observation. */
  capture(context:OperationContext,observation:Observation):Promise<ObservedDocumentLink[]>;
  validate(context:OperationContext,observation:Observation,links:readonly ObservedDocumentLink[]):Promise<boolean>;
  /** Host owns page allocation, access checks (including redirects), reading and release. */
  read(context:OperationContext,link:ObservedDocumentLink):Promise<DocumentEvidence>;
  forget?(observationId:string):Promise<void>;
}
const readTool:Tool={name:'browser_read_documents',effect:'read',description:'Read 1 to 3 currently observed document links. Returns fresh source evidence, never cached answers. Select exact linkIds from documentLinks in the current observation. No arbitrary URLs or scripts.',parameters:{type:'object',properties:{linkIds:{type:'array',items:{type:'string'},minItems:1,maxItems:3,uniqueItems:true}},required:['linkIds'],additionalProperties:false}};

/** A model can declare bounded title intents up front; only fresh, unique observed links are read. */
export function withDocumentReadContinuation(base:BrowserMemoryPort,options:{required?:boolean}={}):BrowserMemoryPort {
  if(base.followUp)fail('memory_followup_already_owned');
  const normalize=(s:string)=>s.normalize('NFKC').replace(/\s+/g,'').toLocaleLowerCase();
  return {lookup:base.lookup.bind(base),run:base.run.bind(base),...(base.resume?{resume:base.resume.bind(base)}:{}),...(base.capture?{capture:base.capture.bind(base)}:{}),...(base.learn?{learn:base.learn.bind(base)}:{}),followUp:{
    required:options.required===true,
    parameters:{type:'object',properties:{titles:{type:'array',description:'Minimal distinctive subject nouns from the current request, without operation words. For a subject Invoices and task compare invoice search APIs, propose Invoices, not invoice search API. Match a short substring of the future visible link title; never invent its full title or URL. Each subject must resolve to exactly one fresh link; otherwise normal observation remains available.',minItems:1,maxItems:3,uniqueItems:true,items:{type:'string',minLength:1,maxLength:120}}},required:['titles'],additionalProperties:false},
    async run(input,context,api){
      const titles=input.titles;if(Object.keys(input).join(',')!=='titles'||!Array.isArray(titles)||!titles.length||titles.length>3||titles.some(t=>typeof t!=='string'||t.trim().length<1||t.length>120)||new Set(titles.map(t=>normalize(t as string))).size!==titles.length)fail('document_intent_invalid');
      const resolve=(observation:Observation):{links:ObservedDocumentLink[]}|{error:string;actionIssued:false}=>{
        const data=observation.data,links=data&&typeof data==='object'&&!Array.isArray(data)&&Array.isArray(data.documentLinks)?data.documentLinks:[];
        const selected:ObservedDocumentLink[]=[];
        for(const title of titles){const matches=links.filter(link=>link&&typeof link==='object'&&!Array.isArray(link)&&typeof link.title==='string'&&typeof link.linkId==='string'&&typeof link.url==='string'&&normalize(link.title).includes(normalize(title as string)));
          if(matches.length!==1)return {error:matches.length?'document_intent_ambiguous':'document_intent_missing',actionIssued:false};
          const link=matches[0] as unknown as ObservedDocumentLink;if(selected.some(x=>x.linkId===link.linkId))return {error:'document_intent_overlap',actionIssued:false};selected.push(link);
        }
        return {links:selected};
      };
      const selected=resolve(context.observation);if('error' in selected)return selected;
      context.signal?.throwIfAborted();let previous:JsonObject|undefined;
      try{previous=await api.act('browser_read_documents',{linkIds:selected.links.map(x=>x.linkId)});}
      catch(error){if(!(error instanceof BrowserAgentError)||!['binding_changed','observation_changed'].includes(error.code))throw error;}
      const receipt=previous?.receipt as JsonObject|undefined;
      if(previous&&!(previous.error==='execution_not_started'&&!previous.requiresUserInput&&receipt?.status==='not_started'))return previous;
      // One read-only refresh, preserving subjects and source URLs. No procedure/write is rerun.
      context.signal?.throwIfAborted();const fresh=await api.observe({mode:'accessibility'});context.signal?.throwIfAborted();
      if(fresh.state!=='ready')return {error:'document_intent_access_required',actionIssued:false};
      const next=resolve(fresh);if('error' in next)return next;
      if(next.links.some((link,index)=>link.url!==selected.links[index]!.url))return {error:'document_intent_changed',actionIssued:false};
      return {...await api.act('browser_read_documents',{linkIds:next.links.map(x=>x.linkId)}),readRecovery:{attempts:2,...(receipt?{previousReceipt:receipt}:{})}};

    },
  }};
}

/** Optional read composition; the existing host/Pi keeps all task, policy, browser and model ownership. */
export function createDocumentResearchPort(options:{browser:BrowserPort;documents:DocumentReadHost;concurrency?:1|2|3}):BrowserPort {
  const concurrency=options.concurrency??1;if(![1,2,3].includes(concurrency))fail('document_concurrency_invalid');
  const base=options.browser,seen=new Map<string,{lease:string;observation:Observation;links:ObservedDocumentLink[]}>(),active=new Set<Promise<unknown>>();
  let closing=false;const leases=new Set<string>();
  const check=(ctx:OperationContext)=>{ctx.signal.throwIfAborted();if(closing||!leases.has(ctx.lease))fail('lease_invalid');};
  const tracked=<T>(operation:()=>Promise<T>)=>{const task=operation();active.add(task);void task.finally(()=>active.delete(task)).catch(()=>{});return task;};
  const forget=async()=>{const ids=[...seen.keys()];seen.clear();await Promise.all(ids.map(id=>options.documents.forget?.(id)));};
  const enrich=async(ctx:OperationContext,observation:Observation):Promise<Observation>=>{
    check(ctx);await forget();if(observation.state!=='ready')return observation;
    const links=await options.documents.capture(ctx,observation);check(ctx);
    if(links.length>48||new Set(links.map(x=>x.linkId)).size!==links.length||links.some(x=>!x.linkId||x.linkId.length>160||!x.title||x.title.length>240||!/^https?:\/\//.test(x.url)))fail('document_links_invalid');
    if(!await base.validate(ctx,observation.binding)||!await options.documents.validate(ctx,observation,links))fail('observation_changed');
    seen.set(observation.observationId,{lease:ctx.lease,observation:clone(observation),links:clone(links)});
    const data=observation.data&&typeof observation.data==='object'&&!Array.isArray(observation.data)?observation.data:{};
    return {...observation,data:{...data,documentLinks:clone(links)} as unknown as Json};
  };
  const read=async(ctx:OperationContext,action:Action):Promise<ExecutionResult>=>{
    check(ctx);const row=seen.get(action.observationId??''),ids=action.arguments.linkIds;
    if(Object.keys(action.arguments).join(',')!=='linkIds'||!Array.isArray(ids)||!ids.length||ids.length>3||ids.some(x=>typeof x!=='string')||new Set(ids).size!==ids.length)fail('document_arguments_invalid');
    if(!row||row.lease!==ctx.lease||!bindingEqual(row.observation.binding,action.binding))fail('observation_required');
    const links=ids.map(id=>row.links.find(x=>x.linkId===id)??fail('document_link_unobserved'));
    if(!await base.validate(ctx,action.binding)||!await options.documents.validate(ctx,row.observation,links))fail('binding_changed');
    const results:({linkId:string;source:DocumentEvidence}|{linkId:string;error:string})[]=new Array(links.length);let cursor=0;
    const worker=async()=>{for(;;){const index=cursor++;if(index>=links.length)return;check(ctx);const link=links[index]!;
      // Revalidate before each physical read; a changed source never authorizes an unstarted read.
      if(!await base.validate(ctx,action.binding)||!await options.documents.validate(ctx,row.observation,[link]))fail('binding_changed');
      try{const source=await options.documents.read(ctx,clone(link));check(ctx);
        if(!source.sourceId||!source.url||!source.title||typeof source.text!=='string'||source.text.length>32000||typeof source.truncated!=='boolean'||!/^sha256:[a-f0-9]{64}$/.test(source.contentHash)||!Number.isFinite(Date.parse(source.observedAt)))fail('document_evidence_invalid');
        results[index]={linkId:link.linkId,source:clone(source)};
      }catch(error){check(ctx);results[index]={linkId:link.linkId,error:error instanceof Error&&'code' in error?String(error.code):'document_read_failed'};}
    }};
    const workers=await Promise.allSettled(Array.from({length:Math.min(concurrency,links.length)},worker));
    const rejected=workers.find(x=>x.status==='rejected');if(rejected?.status==='rejected')throw rejected.reason;
    check(ctx);if(!await base.validate(ctx,action.binding)||!await options.documents.validate(ctx,row.observation,links))fail('binding_changed');
    const observation={...clone(row.observation),data:{...(row.observation.data as object),documentLinks:clone(row.links)} as unknown as Json};
    return {status:'confirmed',evidenceRefs:results.flatMap(x=>'source' in x?[x.source.sourceId]:[]),data:{documents:results as unknown as Json},observation};
  };
  return {
    async acquire(owner){if(closing||leases.size)fail('browser_lease_busy');const lease=await base.acquire(owner);leases.add(lease);return lease;},
    async release(lease){if(!leases.has(lease))return;closing=true;leases.delete(lease);try{await Promise.allSettled([...active]);await forget();await base.release(lease);}finally{closing=false;}},
    async tools(lease,signal){return [...await base.tools(lease,signal),clone(readTool)];},
    observe:(ctx,tab,settings)=>tracked(async()=>enrich(ctx,await base.observe(ctx,tab,settings))),
    validate:(ctx,binding:Binding)=>{check(ctx);return base.validate(ctx,binding);},
    execute:(ctx,action)=>tracked(async()=>{if(action.tool===readTool.name)return read(ctx,action);const result=await base.execute(ctx,action);
      // A post-action read failure cannot retract a confirmed dispatch or cause a duplicate write.
      if(result.observation){try{result.observation=await enrich(ctx,result.observation);}catch{await forget();delete result.observation;
        // Repair only the failed read, within the same operation. Never replay the confirmed action.
        if(result.status==='confirmed')for(let attempt=0;attempt<2&&!ctx.signal.aborted;attempt++){
          try{result.observation=await enrich(ctx,await base.observe(ctx,action.binding.tabId));break;}catch{await forget();}
        }
      }}
      else await forget();return result;}),
    reconcile:(...args)=>base.reconcile(...args),verify:(...args)=>base.verify(...args),
  };
}
