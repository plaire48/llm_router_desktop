import type {Page,Frame,ElementHandle,JSHandle,Request,Locator} from 'playwright-core';
import type {Action,Binding,BrowserPort,Checkpoint,CompletionCandidate,ExecutionResult,Json,Observation,ObserveOptions,OperationContext,Receipt,Tool,Verification} from './types.js';
import {bindingEqual,BrowserAgentError,clone,fail} from './contracts.js';

export interface McpClient {
  listTools():Promise<{tools:{name:string;inputSchema:{properties?:Record<string,unknown>;required?:string[]}}[]}>;
  callTool(request:{name:string;arguments:Record<string,unknown>},schema?:unknown,options?:{signal?:AbortSignal}):Promise<{isError?:boolean;content?:{type:string;text?:string}[]}>;
}
export interface PlaywrightTab {tabId:string;page:Page;client:McpClient}
export interface PlaywrightPortOptions {
  /** Only explicitly authorized host tabs. Popups must be separately enrolled by the host. */
  tabs():readonly PlaywrightTab[];
  /** Must classify auth/protected surfaces before any DOM read or snapshot. No URL heuristic is built in. */
  access(tab:PlaywrightTab,context:OperationContext):Promise<Observation['state']>;
  verify(context:OperationContext,checkpoint:Checkpoint,candidate?:CompletionCandidate):Promise<Verification>;
  reconcile(context:OperationContext,receipt:Receipt):Promise<ExecutionResult>;
  actionTimeoutMs?:number;
  /** Optional host-authorized DOM roots. All observations/actions stay inside these roots. */
  scope?(tab:PlaywrightTab):readonly {frame:Frame;root:Locator}[];
}
type Tracker={revision:number;submissions:number;identity(node:Node):number;disconnect():void};
type FrameState={frame:Frame;id:string;documentId:string;tracker?:JSHandle<Tracker>};
type Target={ref?:string;handle?:ElementHandle;frameId?:string;frameDocumentId?:string;description:string};
type Seen={observation:Observation;targets:Map<string,Target>;mode:ObserveOptions['mode'];frameId?:string};
type TabState={tab:PlaywrightTab;frames:Map<Frame,FrameState>;seen:Map<string,Seen>;autoScope?:{frame:Frame;root:Locator}[]|null;dispose():Promise<void>};
const sensitiveTarget=(el:Node)=>el instanceof HTMLInputElement&&(['password','hidden'].includes(el.type)||['current-password','new-password','one-time-code'].some(x=>el.autocomplete.split(/\s+/).includes(x)));
const editableTarget=(el:Node)=>el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement&&!['button','submit','reset','checkbox','radio','file','image','range','color'].includes(el.type)||el instanceof HTMLElement&&el.isContentEditable;
const target={type:'string',description:'Exact observed targetId; accessibility snapshot [ref=...] or structural candidate targetId.'};
const parameters=(extra:Record<string,Json>={})=>({type:'object',properties:{targetId:target,...extra},required:['targetId',...Object.keys(extra)],additionalProperties:false});
const tools:Tool[]=[
  {name:'browser_click',effect:'write',description:'Click one observed element.',parameters:parameters()},
  {name:'browser_type',effect:'write',description:'Replace the text of an observed input or contenteditable.',parameters:parameters({text:{type:'string',maxLength:16000}})},
  {name:'browser_press_key',effect:'write',description:'Press one allowed key on an observed element.',parameters:parameters({key:{type:'string',enum:['Tab','Enter','Escape','ArrowDown','ArrowUp','Space','Backspace']}})},
  {name:'browser_select_option',effect:'write',description:'Select observed option values.',parameters:parameters({values:{type:'array',items:{type:'string'},maxItems:16}})},
];
const refPattern=/\[ref=((?:f\d+)?e\d+)\]/g;

/** Optional adapter: reuses host-owned Playwright pages and MCP clients. It launches no browser. */
export function createPlaywrightMcpPort(options:PlaywrightPortOptions):BrowserPort {
  const timeout=options.actionTimeoutMs??5000;
  if(!Number.isFinite(timeout)||timeout<100||timeout>30_000)fail('action_timeout_invalid');
  const states=new Map<string,TabState>(),leases=new Map<string,OperationContext['owner']>(),active=new Set<Promise<unknown>>();
  let releasing=false;
  const parameters=new WeakMap<McpClient,Map<string,'ref'|'target'>>();
  const catalog=async(client:McpClient)=>{
    const cached=parameters.get(client);if(cached)return cached;
    const listed=await client.listTools(),fields=new Map<string,'ref'|'target'>();
    if(!listed.tools.some(t=>t.name==='browser_snapshot'))fail('mcp_catalog_incompatible');
    for(const name of ['browser_click','browser_type','browser_select_option']){
      const tool=listed.tools.find(t=>t.name===name),required=tool?.inputSchema.required??[];
      if(required.includes('target'))fields.set(name,'target');else if(required.includes('ref'))fields.set(name,'ref');else fail('mcp_catalog_incompatible');
    }
    parameters.set(client,fields);return fields;
  };
  const check=(context:OperationContext)=>{
    context.signal.throwIfAborted();const owner=leases.get(context.lease);
    if(!owner||owner.instanceId!==context.owner.instanceId||owner.generation!==context.owner.generation||owner.projectId!==context.scope.projectId)fail('lease_invalid');
  };
  const tabState=(tabId:string):TabState=>{
    const tab=options.tabs().find(x=>x.tabId===tabId);if(!tab||tab.page.isClosed())return fail('tab_unavailable');
    const previous=states.get(tabId);if(previous&&previous.tab.page===tab.page&&previous.tab.client===tab.client)return previous;
    if(previous)fail('tab_identity_changed');
    const frames=new Map<Frame,FrameState>();
    const attach=(frame:Frame)=>{if(!frames.has(frame))frames.set(frame,{frame,id:crypto.randomUUID(),documentId:crypto.randomUUID()});};
    const navigate=(frame:Frame)=>{attach(frame);const state=frames.get(frame)!;void state.tracker?.dispose().catch(()=>{});state.tracker=undefined;state.documentId=crypto.randomUUID();};
    const detach=(frame:Frame)=>{const state=frames.get(frame);void state?.tracker?.dispose().catch(()=>{});frames.delete(frame);};
    tab.page.frames().forEach(attach);tab.page.on('frameattached',attach);tab.page.on('framenavigated',navigate);tab.page.on('framedetached',detach);
    const state:TabState={tab,frames,seen:new Map(),async dispose(){tab.page.off('frameattached',attach);tab.page.off('framenavigated',navigate);tab.page.off('framedetached',detach);await Promise.allSettled([...frames.values()].map(async f=>{try{await f.tracker?.evaluate(t=>t.disconnect());}finally{await f.tracker?.dispose();}}));frames.clear();}};
    states.set(tabId,state);return state;
  };
  // The main content root of a long page, or nothing when the page is small or has no such landmark.
  const defaultScope=async(state:TabState)=>{
    const main=state.tab.page.mainFrame();
    const length=await main.evaluate(()=>document.body?.innerText?.length??0).catch(()=>0);
    // Many frames usually means advertising iframes whose churn would invalidate every observation.
    const crowded=state.frames.size>8;
    if(length<=60_000&&!crowded)return undefined;
    for(const selector of ['main','[role="main"]','article','#content','#mw-content-text','form']){
      const root=main.locator(selector).first();
      if(await root.count().catch(()=>0))return [{frame:main,root}];
    }
    return crowded?[{frame:main,root:main.locator('body')}]:undefined;
  };
  const binding=async(state:TabState):Promise<Binding>=>{
    if(!options.scope&&state.frames.size>32)fail('frame_limit_exceeded');
    const scoped=options.scope?.(state.tab)??state.autoScope??undefined;
    if(scoped&&(!scoped.length||scoped.length>16||scoped.some(x=>!state.frames.has(x.frame))))fail('scope_invalid');
    const included=scoped?new Set([state.tab.page.mainFrame()]):undefined;
    for(const item of scoped??[])for(let frame:Frame|null=item.frame;frame;frame=frame.parentFrame())included!.add(frame);
    const before=[...state.frames.values()].filter(f=>!included||included.has(f.frame));
    // Without a scope, a child frame that detaches or reloads mid-binding (advertising iframes, browser quality
    // baselines 4~7, 2026-10-21) is left out of the binding instead of failing it; only the main frame is fatal.
    const mainFrame=state.tab.page.mainFrame();
    const rows=await Promise.all(before.map(async f=>{
      const documentId=f.documentId,volatile=()=>{if(scoped||f.frame===mainFrame)fail('frame_changed');return null;};
      try{
      const tracker=f.tracker??await f.frame.evaluateHandle(()=>{
        const identities=new WeakMap<Node,number>();let serial=0;
        const state={revision:0,submissions:0,identity:(node:Node)=>{let key=identities.get(node);if(!key){key=++serial;identities.set(node,key);}return key;},disconnect:()=>{}};
        const observer=new MutationObserver(()=>{state.revision++;});observer.observe(document,{subtree:true,childList:true,characterData:true,attributes:true});
        const input=()=>{state.revision++;};document.addEventListener('input',input,true);document.addEventListener('change',input,true);
        const submit=(event:Event)=>{queueMicrotask(()=>{const form=event.target;if(!event.defaultPrevented&&form instanceof HTMLFormElement&&['','_self'].includes(form.target)&&form.method!=='dialog'){state.submissions++;state.revision++;}});};document.addEventListener('submit',submit,true);
        state.disconnect=()=>{document.removeEventListener('submit',submit,true);observer.disconnect();document.removeEventListener('input',input,true);document.removeEventListener('change',input,true);};return state;
      });
      if(f.documentId!==documentId||f.frame.isDetached()){await tracker.dispose().catch(()=>{});return volatile();}
      f.tracker=tracker;const revision=await tracker.evaluate(t=>t.revision);
      if(f.documentId!==documentId||f.frame.isDetached())return volatile();
      let effectiveRevision:string|number=revision;
      if(scoped){
        const proofs=[];for(const item of scoped.filter(x=>x.frame===f.frame)){
          if(await item.root.count()!==1)fail('scope_invalid');const handle=await item.root.elementHandle();if(!handle)fail('scope_invalid');
          try{if(await handle.ownerFrame()!==f.frame)fail('scope_invalid');proofs.push(await tracker.evaluate((tracker,node)=>{
            if(!node||!node.isConnected)throw Error('scope_detached');
            const shown=(el:Element)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return !!r.width&&!!r.height&&s.visibility!=='hidden'&&s.display!=='none';};
            const controls=Array.from(node.querySelectorAll('input,textarea,button,select,a[href],[contenteditable=true],[onclick],[tabindex]')).filter(el=>shown(el)&&!(el instanceof HTMLInputElement&&(['password','hidden'].includes(el.type)||/one-time-code|password/.test(el.autocomplete))));
            const attributes=(el:Element)=>Object.fromEntries(['role','aria-label','aria-expanded','aria-checked','aria-selected','aria-disabled','title','type','name','href','target','action','method','form','formaction','formmethod','formtarget','required','multiple','contenteditable','tabindex'].map(key=>[key,el.getAttribute(key)]));
            const form=node.closest('form');
            return {root:tracker.identity(node),attributes:attributes(node),form:form?{id:tracker.identity(form),attributes:attributes(form)}:null,text:(node as HTMLElement).innerText?.slice(0,64000)??'',controls:controls.map(el=>({id:tracker.identity(el),tag:el.tagName,attributes:attributes(el),value:el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement||el instanceof HTMLSelectElement?el.value:null,checked:el instanceof HTMLInputElement?el.checked:null,options:el instanceof HTMLSelectElement?Array.from(el.options).map(x=>({value:x.value,text:x.text,disabled:x.disabled,selected:x.selected})):null,editable:(el as HTMLElement).isContentEditable,disabled:(el as HTMLInputElement).disabled,readOnly:(el as HTMLInputElement).readOnly}))};
          },handle));}finally{await handle.dispose();}
        }
        const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(proofs)));effectiveRevision=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
      }
      if(f.documentId!==documentId)return volatile();
      return {id:f.id,documentId,parentId:state.frames.get(f.frame.parentFrame()!)?.id??null,revision:effectiveRevision};
      }catch(error){
        if(f.documentId!==documentId||f.frame.isDetached()||error instanceof Error&&/Execution context was destroyed|Frame was detached|Cannot find context with specified id/.test(error.message))return volatile();
        throw error;
      }
    }));
    if(before.some((f,i)=>rows[i]&&(state.frames.get(f.frame)!==f||f.documentId!==rows[i]!.documentId))||(scoped&&before.length!==rows.filter(Boolean).length))fail('frame_changed');
    const stable=rows.filter((row):row is NonNullable<typeof row>=>!!row);
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable)));
    const main=stable.find(x=>x.id===state.frames.get(mainFrame)?.id);if(!main)return fail('frame_changed');
    return {tabId:state.tab.tabId,documentId:main.documentId,revision:String(main.revision),frameTreeRevision:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')};
  };
  const clearSeen=async(state:TabState)=>{
    const old=[...state.seen.values()];state.seen.clear();await Promise.allSettled(old.flatMap(x=>[...x.targets.values()].flatMap(t=>t.handle?[t.handle.dispose()]:[])));
  };
  const guard=async(context:OperationContext,state:TabState)=>{check(context);const access=await options.access(state.tab,context);check(context);return access;};
  const observe=async(context:OperationContext,tabId:string,observeOptions:ObserveOptions={}):Promise<Observation>=>{
    check(context);const state=tabState(tabId),access=await guard(context,state);
    if(access!=='ready'){
      await clearSeen(state);
      return {state:access,binding:{tabId,documentId:'protected',revision:'0'},observationId:crypto.randomUUID()};
    }
    if(!['accessibility','structure'].includes(observeOptions.mode??'accessibility'))fail('observation_mode_invalid');
    await catalog(state.tab.client);await clearSeen(state);
    // Let a page that is still mutating (lazy images, scripts) settle before the observation is bound, so a
    // mutation burst does not fail the whole observe (browser quality baseline 2, 2026-10-21: Korean Wikipedia).
    // The automatic scope must be known before the first binding, so frames outside it (advertising iframes) do
    // not count as frame changes while the page settles.
    state.autoScope=!options.scope&&observeOptions.mode!=='structure'?(await defaultScope(state))??null:null;
    let initial=await binding(state);
    for(let attempt=0;attempt<6;attempt++){await new Promise(resolve=>setTimeout(resolve,250));check(context);const again=await binding(state);if(bindingEqual(initial,again))break;initial=again;}
    const targets=new Map<string,Target>();let data:Json;
    let published=false;
    try{
    // A large page without a host scope (browser quality baseline 4, 2026-10-21: Wikipedia 64k tokens per observe,
    // demoqa ads) is observed through its main content root instead of the whole document: an aria snapshot of
    // that root plus its interactive candidates, which the scoped mode already produces.
    const autoScope=state.autoScope??undefined;
    const scopeFn=options.scope??(autoScope?()=>autoScope:undefined);
    if(observeOptions.mode==='structure'||scopeFn){
      const candidates:Json[]=[];let truncated=false;
      const roots=scopeFn?.(state.tab)??[...state.frames.values()].map(f=>({frame:f.frame,root:f.frame.locator('body')}));
      const snapshots:string[]=[];
      for(const item of roots){const f=state.frames.get(item.frame);if(!f)fail('scope_invalid');
        if(observeOptions.frameId&&f.id!==observeOptions.frameId)continue;
        if(scopeFn&&observeOptions.mode!=='structure'){const aria=await item.root.ariaSnapshot({timeout});if(aria.length>60_000)truncated=true;snapshots.push(aria.slice(0,60_000));}
        const locator=item.root.locator('input:not([type="password"]):not([type="hidden"]),textarea,button,select,a[href],[contenteditable="true"],[onclick],[tabindex]');
        const metadata=await locator.evaluateAll(elements=>{const visible=elements.map((el,index)=>{
          const box=el.getBoundingClientRect(),style=getComputedStyle(el);
          const control=el as HTMLInputElement;
          const sensitive=el instanceof HTMLInputElement&&(['password','hidden'].includes(el.type)||['current-password','new-password','one-time-code'].some(x=>el.autocomplete.split(/\s+/).includes(x)));
          return {index,visible:!sensitive&&box.width>0&&box.height>0&&style.visibility!=='hidden'&&style.display!=='none',tag:el.tagName.toLowerCase(),type:el instanceof HTMLInputElement?el.type:'',role:el.getAttribute('role')??'',name:(el.getAttribute('aria-label')??el.getAttribute('title')??(el instanceof HTMLInputElement&&['button','submit','reset'].includes(el.type)?el.value:el.textContent)??'').trim().slice(0,120),context:((el.closest('tr') as HTMLElement|null)?.innerText??el.parentElement?.innerText??'').trim().slice(0,240),editable:el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement||(el as HTMLElement).isContentEditable,disabled:control.disabled===true,readOnly:control.readOnly===true};
        }).filter(x=>x.visible);return {items:visible.slice(0,48),truncated:visible.length>48};});
        truncated ||= metadata.truncated;
        const handles=await locator.elementHandles();
        const selected=new Set(metadata.items.map(x=>x.index));await Promise.allSettled(handles.flatMap((h,i)=>selected.has(i)?[]:[h.dispose()]));
        for(const item of metadata.items){
          const handle=handles[item.index];if(!handle)continue;
          const targetId=crypto.randomUUID();targets.set(targetId,{handle,frameId:f.id,frameDocumentId:f.documentId,description:item.name||item.context});
          candidates.push({targetId,frameId:f.id,frameDocumentId:f.documentId,...item});
        }
      }
      if(observeOptions.frameId&&![...state.frames.values()].some(f=>f.id===observeOptions.frameId))fail('frame_unavailable');
      data={mode:observeOptions.mode??'accessibility',candidates,truncated,...(snapshots.length?{snapshot:snapshots.join('\n').slice(0,100000)}:{})};
      if(!scopeFn)(data as Record<string,Json>).mode='structure';
      if(autoScope)(data as Record<string,Json>).autoScoped=true;
    }else{
      const result=await state.tab.client.callTool({name:'browser_snapshot',arguments:{}},undefined,{signal:context.signal});
      if(result.isError)fail('snapshot_failed');
      const snapshot=(result.content??[]).filter(x=>x.type==='text').map(x=>x.text??'').join('\n');
      // A large page (browser quality baseline 1, 2026-10-21: Korean Wikipedia) is cut at the same 100,000
      // characters the scoped mode uses and marked truncated, instead of pausing the task before any observation.
      const truncated=snapshot.length>100_000,visible=truncated?snapshot.slice(0,100_000):snapshot;
      for(const match of visible.matchAll(refPattern))targets.set(match[1]!,{ref:match[1]!,description:'Observed browser element'});
      data={mode:'accessibility',snapshot:visible,...(truncated?{truncated:true}:{})};
    }
    const current=await binding(state);check(context);
    if(!bindingEqual(initial,current)||await guard(context,state)!=='ready'){
      await Promise.allSettled([...targets.values()].flatMap(t=>t.handle?[t.handle.dispose()]:[]));fail('observation_changed');
    }
    const observation:Observation={state:'ready',binding:current,observationId:crypto.randomUUID(),data:{...data as Record<string,Json>,frames:[...state.frames.values()].filter(f=>!options.scope||f.frame===state.tab.page.mainFrame()||options.scope(state.tab).some(x=>x.frame===f.frame)).map(f=>{let address='';try{const u=new URL(f.frame.url());if(/^https?:$/.test(u.protocol))address=u.origin+u.pathname;}catch{}return {frameId:f.id,documentId:f.documentId,parentId:state.frames.get(f.frame.parentFrame()!)?.id??null,address,name:/^[\w.:-]{1,80}$/.test(f.frame.name())?f.frame.name():''};})}};
    state.seen.set(observation.observationId,{observation,targets,mode:observeOptions.mode??'accessibility',...(observeOptions.frameId?{frameId:observeOptions.frameId}:{})});
    published=true;
    return clone(observation);
    }finally{
      if(!published)await Promise.allSettled([...targets.values()].flatMap(t=>t.handle?[t.handle.dispose()]:[]));
    }
  };
  const validate=async(context:OperationContext,expected:Binding)=>{
    try{const state=tabState(expected.tabId);if(await guard(context,state)!=='ready')return false;const now=await binding(state);check(context);return bindingEqual(now,expected);}catch{return false;}
  };
  const execute=async(context:OperationContext,action:Action):Promise<ExecutionResult>=>{
    check(context);const state=tabState(action.binding.tabId);
    const seen=state.seen.get(action.observationId??'');if(!seen||!bindingEqual(seen.observation.binding,action.binding))return fail('observation_required');
    if(!tools.some(x=>x.name===action.tool))fail('tool_unavailable');
    const args=action.arguments,targetId=args.targetId;if(typeof targetId!=='string')fail('target_required');
    const target=seen.targets.get(targetId);if(!target)fail('target_unobserved');
    if(!await validate(context,action.binding))return fail('binding_changed');
    // Only fixed operations and observed opaque targets: no caller script, selector, storage or upload API.
    const allowed=action.tool==='browser_click'?['targetId']:action.tool==='browser_type'?['targetId','text']:action.tool==='browser_select_option'?['targetId','values']:['targetId','key'];
    if(Object.keys(args).some(x=>!allowed.includes(x)))fail('tool_arguments_invalid');
    if(action.tool==='browser_type'&&(typeof args.text!=='string'||args.text.length>16_000))fail('tool_arguments_invalid');
    if(action.tool==='browser_press_key'&&(typeof args.key!=='string'||!['Tab','Enter','Escape','ArrowDown','ArrowUp','Space','Backspace'].includes(args.key)))fail('tool_arguments_invalid');
    if(action.tool==='browser_select_option'&&(!Array.isArray(args.values)||args.values.some(x=>typeof x!=='string')||args.values.length>16))fail('tool_arguments_invalid');
    if(target.handle){
      const owner=await target.handle.ownerFrame(),frame=owner?state.frames.get(owner):undefined;
      if(!frame||frame.id!==target.frameId||frame.documentId!==target.frameDocumentId||!await target.handle.evaluate(el=>el.isConnected))fail('target_changed');
      if(await target.handle.evaluate(sensitiveTarget))fail('target_sensitive');
      if(action.tool==='browser_type'&&(!await target.handle.evaluate(editableTarget)||!await target.handle.isEditable()))fail('target_not_editable');
    }
    const beforeSubmit=new Map(await Promise.all([...state.frames.values()].filter(f=>f.tracker).map(async f=>[f,{documentId:f.documentId,count:await f.tracker!.evaluate(t=>t.submissions)}] as const)));
    check(context);const committed=new Set<Frame>();const commit=(frame:Frame)=>{committed.add(frame);};state.tab.page.on('framenavigated',commit);
    let dispatched=false;const navigations=new Set<Promise<unknown>>();
    const navigation=(request:Request)=>{
      if(!request.isNavigationRequest())return;let frame:Frame;try{frame=request.frame();}catch{return;}
      if(!state.frames.has(frame)||!beforeSubmit.has(state.frames.get(frame)!))return;
      const settled=state.tab.page.waitForEvent('framenavigated',{predicate:next=>next===frame,timeout}).then(()=>frame.waitForLoadState('domcontentloaded',{timeout}));
      // A dispatched navigation is observed to settlement; a timeout never replays it.
      void settled.catch(()=>{});navigations.add(settled);
    };
    state.tab.page.on('request',navigation);
    try{
      if(target.ref){
        const fields=await catalog(state.tab.client),field=fields.get(action.tool);
        const handle=await state.tab.page.locator('aria-ref='+target.ref).elementHandle();
        if(!handle)fail('target_changed');
        try{const owner=await handle.ownerFrame();if(!owner||!state.frames.has(owner))fail('target_changed');if(await handle.evaluate(sensitiveTarget))fail('target_sensitive');if(action.tool==='browser_type'&&(!await handle.evaluate(editableTarget)||!await handle.isEditable()))fail('target_not_editable');}finally{await handle.dispose();}
        if(!await validate(context,action.binding))fail('binding_changed');
        const input:Record<string,unknown>=field?{[field]:target.ref}:{};
        if(action.tool==='browser_type')input.text=args.text;
        if(action.tool==='browser_select_option')input.values=args.values;
        if(action.tool==='browser_press_key'){
          // Global MCP press_key has no ref; require a target-bound native press instead.
          const handle=await state.tab.page.locator('aria-ref='+target.ref).elementHandle();if(!handle)fail('target_changed');
          try{dispatched=true;await handle.press(args.key as string,{timeout});}finally{await handle.dispose();}
        }else{
          // Keep the physical RPC tracked through settlement even if the core cancels its waiter.
          dispatched=true;const result=await state.tab.client.callTool({name:action.tool,arguments:input});if(result.isError)fail('browser_action_failed');
        }
      }else if(target.handle){
        dispatched=true;
        if(action.tool==='browser_click')await target.handle.click({timeout});
        if(action.tool==='browser_type')await target.handle.fill(args.text as string,{timeout});
        if(action.tool==='browser_press_key')await target.handle.press(args.key as string,{timeout});
        if(action.tool==='browser_select_option')await target.handle.selectOption(args.values as string[],{timeout});
      }else fail('target_unobserved');
      check(context);
      // Native click may resolve before a default form submission issues its
      // request. Wait only for observed, unprevented same-frame submissions.
      for(const [frame,before] of beforeSubmit){
        if(frame.documentId!==before.documentId||!frame.tracker)continue;
        let submitted=false;try{submitted=await frame.tracker.evaluate(t=>t.submissions)>before.count;}catch{continue;}
        if(submitted){
          if(!committed.has(frame.frame)){try{await state.tab.page.waitForEvent('framenavigated',{predicate:next=>next===frame.frame,timeout});}catch{/* Action stays confirmed; no replay. */}}
          try{await frame.frame.waitForLoadState('domcontentloaded',{timeout});}catch{}
        }
      }
      let after:Observation|undefined;
      const read=()=>observe(context,action.binding.tabId,{mode:seen.mode,...(seen.frameId?{frameId:seen.frameId}:{})});
      try{
        if(navigations.size)await Promise.allSettled([...navigations]);
        after=await read();
        // Requests can arrive while the first post-action snapshot is being read.
        if(navigations.size){await Promise.allSettled([...navigations]);after=await read();}
      }catch{if(navigations.size){await Promise.allSettled([...navigations]);try{after=await read();}catch{}}/* Preserve the confirmed receipt. */}
      return {status:'confirmed',evidenceRefs:['action:'+action.actionId],...(after?{observation:after}:{})};
    }catch(error){return {status:dispatched?'unconfirmed':'not_started',evidenceRefs:[],data:{error:error instanceof BrowserAgentError?error.code:'browser_action_failed'}};}
    finally{state.tab.page.off('request',navigation);state.tab.page.off('framenavigated',commit);}
  };
  const tracked=<T>(operation:()=>Promise<T>):Promise<T>=>{const run=operation();active.add(run);void run.finally(()=>active.delete(run)).catch(()=>{});return run;};
  return {
    async acquire(owner){if(releasing||leases.size||active.size)fail('browser_lease_busy');const lease=crypto.randomUUID();leases.set(lease,clone(owner));return lease;},
    async release(lease){if(!leases.has(lease))return;releasing=true;leases.delete(lease);try{await Promise.allSettled([...active]);for(const state of states.values()){await clearSeen(state);await state.dispose();}states.clear();}finally{releasing=false;}},
    async tools(lease){if(!leases.has(lease))fail('lease_invalid');const tabs=options.tabs();if(new Set(tabs.map(t=>t.client)).size!==tabs.length)fail('mcp_client_shared');await Promise.all(tabs.map(t=>catalog(t.client)));return clone(tools);},
    observe:(context,tabId,observeOptions)=>tracked(()=>observe(context,tabId,observeOptions)),validate,
    execute:(context,action)=>tracked(async()=>{try{return await execute(context,action);}catch(error){return {status:'not_started',evidenceRefs:[],data:{error:error instanceof BrowserAgentError?error.code:'browser_preflight_failed'}};}}),
    reconcile:(context,receipt)=>tracked(()=>{check(context);return options.reconcile(context,receipt);}),
    verify:(context,checkpoint,candidate)=>tracked(()=>{check(context);return options.verify(context,checkpoint,candidate);}),
  };
}
