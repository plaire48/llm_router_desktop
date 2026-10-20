import type {BrowserMemoryPort,MemoryContext,MemoryTrace,ProcedureApi,ProcedureSummary} from './memory.js';
import type {Json,JsonObject,Observation,OpenTask} from './types.js';
import {BrowserAgentError,canonical,clone,fail,id} from './contracts.js';

export interface ReviewedProcedure extends ProcedureSummary {
  schemaVersion:1;status:'draft'|'reviewed'|'revalidated';wikiRef:{id:string;version:number;hash:string};
  steps:JsonObject[];
}
export interface ProcedureStore {
  find(context:MemoryContext):Promise<{notes:string[];cards:ReviewedProcedure[]}>;
  get(id:string,version:number,context:MemoryContext):Promise<ReviewedProcedure|null>;
  /** Recheck project/site/wiki version and revocation before each observation/action. */
  current(card:ReviewedProcedure,context:MemoryContext):Promise<boolean>;
  propose(candidate:ReviewedProcedure,projectId:string,signal:AbortSignal):Promise<void>;
}
export interface ReplayMemoryOptions {
  store:ProcedureStore;
  /** Explicit controlled qualification only. Normal requests require revalidated cards. */
  qualification?:boolean;
  /** Host injects existing Nubi runReplay and recordTarget; no second replay engine is installed. */
  replay:{
    runReplay(input:JsonObject,callbacks:{signal:AbortSignal;executeTool(name:string,args:JsonObject,meta?:{replayIndex:number}):Promise<JsonObject>}):Promise<JsonObject>;
    recordTarget(element:JsonObject,view:JsonObject):JsonObject|null;
  };
  /** Converts fresh structural evidence to the existing replay observation contract. */
  view(observation:Observation):Promise<JsonObject>;
  capture?:BrowserMemoryPort['capture'];
  buildCandidate?(experience:{projectId:string;task:OpenTask;trace:MemoryTrace[];signal:AbortSignal}):Promise<ReviewedProcedure|null>;
}
const fields=(value:Json|undefined):JsonObject[]=>Array.isArray(value)?value as JsonObject[]:[];
const forbidden=new Set(['ref','targetId','observationId','documentId','actionId','ordinal','alike','selector','script','code','values']);
function portable(value:Json):boolean {
  if(Array.isArray(value))return value.every(portable);
  if(value&&typeof value==='object')return Object.entries(value).every(([key,item])=>!forbidden.has(key)&&portable(item));
  return true;
}
function valid(card:ReviewedProcedure):boolean {
  if(!card||card.schemaVersion!==1||!id(card.id)||!Number.isSafeInteger(card.version)||card.version<1||!['draft','reviewed','revalidated'].includes(card.status)||typeof card.title!=='string'||!card.title.trim()||card.title.length>180||!id(card.wikiRef?.id)||!Number.isSafeInteger(card.wikiRef.version)||card.wikiRef.version<1||!/^[a-f0-9]{64}$/.test(card.wikiRef.hash)||!Array.isArray(card.steps)||!card.steps.length||card.steps.length>40||!Array.isArray(card.inputs)||card.inputs.length>30||card.inputs.some(x=>!id(x.slot)||typeof x.label!=='string'||!x.label.trim()||x.label.length>120)||new Set(card.inputs.map(x=>x.slot)).size!==card.inputs.length)return false;
  if(!portable(card as unknown as Json)||JSON.stringify(card).length>32000)return false;
  return card.steps.every(step=>step.tool==='press_key'&&!!step.target&&Object.keys(step.args as JsonObject??{}).length===1&&['Tab','Enter','Escape','ArrowDown','ArrowUp','Space','Backspace'].includes((step.args as JsonObject)?.key as string)||step.tool==='click_element'&&!!step.target&&Object.keys(step.args as JsonObject??{}).length===0||step.tool==='fill_form'&&fields(step.fields).length===1&&fields(step.fields).every(field=>!!field.target&&card.inputs.some(x=>x.slot===field.slot))
    // A dropdown choice (browser teach plan T2, 2026-10-21): the chosen values live in an input slot, never in the card.
    ||step.tool==='select_option'&&!!step.target&&typeof step.slot==='string'&&card.inputs.some(x=>x.slot===step.slot)&&Object.keys(step.args as JsonObject??{}).length===0);
}
const summary=(card:ReviewedProcedure):ProcedureSummary=>({id:card.id,version:card.version,title:card.title,inputs:clone(card.inputs)});
const elements=(view:JsonObject)=>fields(view.frames).flatMap(frame=>fields(frame.elements));

/** Adapts stored procedures to the existing deterministic engine and current core lane. */
export function createReplayMemory(options:ReplayMemoryOptions):BrowserMemoryPort {
  const eligible=(card:ReviewedProcedure)=>card.status==='revalidated'||options.qualification===true&&card.status==='reviewed';
  type Continuation={card:ReviewedProcedure;values:JsonObject;context:MemoryContext;index:number;confirmed:JsonObject[]};
  const pending=new Map<string,Continuation>();
  const targetOf=(step:JsonObject)=>(step.tool==='fill_form'?fields(step.fields)[0]!.target:step.target) as JsonObject;
  const execute=async(card:ReviewedProcedure,values:JsonObject,context:MemoryContext,api:ProcedureApi,startAt=0,confirmed:JsonObject[]=[],repairs=new Map<number,JsonObject>()):Promise<JsonObject>=>{
      let observed:Observation|undefined,view:JsonObject|undefined;let issued=0,attempted=-1;const confirmedSteps=clone(confirmed);
      const guard=async()=>{context.signal.throwIfAborted();const fresh=await options.store.get(card.id,card.version,context);if(!fresh||canonical(fresh as unknown as Json)!==canonical(card as unknown as Json)||!await options.store.current(card,{...context,...(observed?{observation:observed}:{})}))fail('procedure_changed');};
      const read=async():Promise<JsonObject>=>{
        observed=await api.observe({mode:'structure'});
        if(observed.state!=='ready')return {error:'procedure_access_required',requiresUserInput:observed.state==='login_required'};
        view=await options.view(observed);
        if(!Array.isArray(view.frames)||!view.frames.length||fields(view.frames).some(x=>x.truncated||x.omittedControls||x.textFiltered))return {error:'procedure_observation_incomplete'};
        return {observation:view};
      };
      const steps=clone(card.steps);for(const [index,target] of repairs){const step=steps[index]!;if(step.tool==='fill_form')fields(step.fields)[0]!.target=target;else step.target=target;}
      try{
        const result=await options.replay.runReplay({steps,values:clone(values),startAt}, {signal:context.signal,executeTool:async(name,args,meta):Promise<JsonObject>=>{
          await guard();
          if(name==='browser_snapshot')return read();
          const step=steps[meta?.replayIndex??-1];
          if(!observed||!view||!step||step.tool!==name)return {error:'procedure_step_invalid'};
          const field=name==='fill_form'?fields(args.fields)[0]:undefined;
          const ref=(field?.field_id??args.ref) as string,expected=targetOf(step);
          const element=elements(view).find(x=>x.ref===ref),actual=element?options.replay.recordTarget(element,view):null;
          if(!actual||canonical(actual)!==canonical(expected))return {error:'procedure_target_changed'};
          attempted=meta!.replayIndex;
          const act=(targetId:string)=>api.act(name==='fill_form'?'browser_type':name==='press_key'?'browser_press_key':name==='select_option'?'browser_select_option':'browser_click',{targetId,...(field?{text:field.value!}:name==='press_key'?{key:(step.args as JsonObject).key!}:name==='select_option'?{values:(Array.isArray(args.values)?args.values:[args.values]).filter(x=>typeof x==='string')}:{})});
          let outcome:JsonObject|undefined,retryUnissued=false;
          try{outcome=await act(ref);}catch(error){
            if(!(error instanceof BrowserAgentError)||!['binding_changed','observation_changed'].includes(error.code))throw error;
            retryUnissued=true;
          }
          // A returned not_started receipt is the same proven non-dispatch as a preflight exception.
          // Never retry confirmed/uncertain actions, user waits or other failures.
          const receipt=outcome?.receipt as JsonObject|undefined,data=outcome?.data as JsonObject|undefined;
          if(outcome?.error==='execution_not_started'&&!outcome.requiresUserInput&&receipt?.status==='not_started'&&['binding_changed','observation_changed'].includes(String(data?.error)))retryUnissued=true;
          if(retryUnissued){
            const fresh=await read();if(fresh.error)return fresh;await guard();
            const matches=elements(view!).filter(x=>{const recorded=options.replay.recordTarget(x,view!);return recorded&&canonical(recorded)===canonical(expected);});
            if(matches.length!==1)return {error:'procedure_target_changed'};
            outcome=await act(matches[0]!.ref as string);
          }
          if(!outcome)return {error:'procedure_step_invalid'};
          if(outcome.error||outcome.requiresUserInput)return outcome;
          issued++;confirmedSteps.push({index:meta!.replayIndex,tool:name,target:clone(expected),...(field?{slot:fields(step.fields)[0]!.slot!,value:field.value!}:{})});return {...outcome,...await read()};
        }});
        let recovery:JsonObject|undefined;const stopped=result.stopped as JsonObject|undefined,index=stopped?.index;
        // Only an unissued suffix after a contiguous confirmed prefix may be repaired.
        // No cursor survives cancellation, approval, a new invocation or uncertain writes.
        if(Number.isInteger(index)&&Number(index)>=startAt&&attempted<Number(index)&&confirmedSteps.length===index&&confirmedSteps.every((x,i)=>x.index===i)&&observed?.state==='ready'){
          const continuationId=crypto.randomUUID();pending.set(continuationId,{card:clone(card),values:clone(values),context,index:Number(index),confirmed:clone(confirmedSteps)});
          context.signal.addEventListener('abort',()=>pending.delete(continuationId),{once:true});
          while(pending.size>8)pending.delete(pending.keys().next().value!);
          recovery={continuationId,remaining:steps.slice(Number(index)).map((step,i)=>({stepIndex:Number(index)+i,tool:step.tool!,target:targetOf(step),...(step.tool==='fill_form'?{slot:fields(step.fields)[0]!.slot!}:{})})),instruction:'Review the fresh observed controls against the original request. To repair this unissued suffix, call resume_browser_procedure once with all changed targets already visible (stepIndex and exact targetId), and this observationId. Unchanged targets are revalidated normally. No inputs, tools or confirmed steps can be changed. If semantics are ambiguous, inspect or ask the user instead.'};
        }
        if(result.completed)observed=await api.observe({mode:'accessibility'});
        return {procedureId:card.id,procedureVersion:card.version,operations:issued,confirmedSteps,...result,...(recovery?{recovery}:{}),subprocedure:true,taskCompleted:false,instruction:'This result covers only the selected subprocedure. Continue the remaining original task with the advertised host tools and this current observation. A completed prefix does not prove remaining inspections or a final answer. Host tool calls are proposals returned to the host, not tools to execute inside the model process. Never claim a listed tool is unavailable without an actual host error. Preserve confirmed steps/values and never restart them. Only independent host task verification can finish the request.'};
      }catch(error){if(context.signal.aborted)throw error;return {error:'procedure_stopped',cause:error instanceof BrowserAgentError?error.code:'replay_failed',operations:issued,confirmedSteps,actionIssued:issued>0};}
  };
  return {
    async lookup(context){
      const found=await options.store.find(context),cards=[];
      for(const card of found.cards.slice(0,3))if(valid(card)&&eligible(card)&&await options.store.current(card,context))cards.push(summary(card));
      return {notes:found.notes,procedures:cards};
    },
    ...(options.capture?{capture:options.capture}:{}),
    async run(selection,context,api:ProcedureApi):Promise<JsonObject>{
      let card=await options.store.get(selection.id,selection.version,context);
      if(!card||card.id!==selection.id||card.version!==selection.version||!valid(card)||!eligible(card))return {error:'procedure_changed',actionIssued:false};
      card=clone(card);
      if(Object.keys(selection.values).length!==card.inputs.length||card.inputs.some(x=>!Object.hasOwn(selection.values,x.slot)||typeof selection.values[x.slot]!=='string'))return {error:'procedure_inputs_invalid',actionIssued:false};
      return execute(card,selection.values,context,api);
    },
    async resume(selection,context,api){
      const saved=pending.get(selection.continuationId);pending.delete(selection.continuationId);
      if(!saved||saved.context.signal!==context.signal||saved.context.projectId!==context.projectId||saved.context.task.taskId!==context.task.taskId||saved.context.task.runId!==context.task.runId||saved.context.observation.binding.tabId!==context.observation.binding.tabId||context.observation.state!=='ready'||selection.observationId!==context.observation.observationId)return {error:'procedure_continuation_invalid',actionIssued:false};
      const card=await options.store.get(saved.card.id,saved.card.version,context);
      if(!card||canonical(card as unknown as Json)!==canonical(saved.card as unknown as Json)||!eligible(card)||!await options.store.current(card,context))return {error:'procedure_changed',actionIssued:false};
      if(!Array.isArray(selection.targets)||!selection.targets.length||selection.targets.length>8||new Set(selection.targets.map(x=>x.stepIndex)).size!==selection.targets.length)return {error:'procedure_repair_invalid',actionIssued:false};
      const view=await options.view(context.observation),repairs=new Map<number,JsonObject>();
      if(!Array.isArray(view.frames)||fields(view.frames).some(x=>x.truncated||x.omittedControls||x.textFiltered))return {error:'procedure_observation_incomplete',actionIssued:false};
      for(const item of selection.targets){
        const step=card.steps[item.stepIndex],element=elements(view).find(x=>x.ref===item.targetId),actual=element?options.replay.recordTarget(element,view):null;
        if(!Number.isInteger(item.stepIndex)||item.stepIndex<saved.index||!step||!actual||!portable(actual)||element?.coveredBy)return {error:'procedure_repair_invalid',actionIssued:false};
        const expected=targetOf(step);
        if(['role','kind','tag','type','frame'].some(key=>actual[key]!==expected[key]))return {error:'procedure_repair_scope_changed',actionIssued:false};
        repairs.set(item.stepIndex,clone(actual));
      }
      return execute(saved.card,saved.values,context,api,saved.index,saved.confirmed,repairs);
    },
    ...(options.buildCandidate?{async learn(experience:{projectId:string;task:OpenTask;trace:MemoryTrace[];signal:AbortSignal}){
      const candidate=await options.buildCandidate!(experience);
      if(!candidate)return;
      if(!valid(candidate)||candidate.status!=='draft')fail('procedure_draft_invalid');
      // Stored steps must not retain any current text value, even in target labels.
      const contains=(item:unknown,text:string):boolean=>typeof item==='string'?item.includes(text):Array.isArray(item)?item.some(x=>contains(x,text)):!!item&&typeof item==='object'&&Object.values(item).some(x=>contains(x,text));
      if(experience.trace.some(x=>typeof x.arguments.text==='string'&&x.arguments.text.length>=3&&contains(candidate,x.arguments.text)))fail('procedure_values_retained');
      await options.store.propose(clone(candidate),experience.projectId,experience.signal);
    }}:{}),
  };
}
