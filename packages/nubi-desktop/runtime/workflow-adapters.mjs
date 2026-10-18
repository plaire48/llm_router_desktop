import {randomUUID} from 'node:crypto';
import {lstat} from 'node:fs/promises';
import {readSource,relativeFile,scopedFile,fail} from './files.mjs';
import {prepareSetupAction} from './setup-actions.mjs';
import {inspectEnvironment,rememberEnvironment} from './environment-inspection.mjs';
import {SourceObservations} from './source-edits.mjs';
import {irreversibleCommand} from './irreversible-actions.mjs';
import {stepCacheKey} from './workflow-run.mjs';
import {cleanModelText} from './model-text.mjs';
import {assertWorkflowCall} from './workflow-policy.mjs';

export const ADAPTER_CATALOG={web:['read','verify'],terminal:['run'],documents:['exists','read','hash']};
const oneLine=value=>cleanModelText(value).slice(0,500);
const textOf=result=>typeof result?.text==='string'?result.text:(result?.content||[]).filter(part=>part.type==='text').map(part=>part.text).join('\n');

export function createAdapters(service,{taskId,runId}={}){
  const owner=service.store,root=service.root;
  const alive=signal=>{signal?.throwIfAborted();if(service.disposed||service.store!==owner||service.root!==root)fail('project_changed');if(service.task(taskId).state==='cancelled')fail('cancelled');};
  const authorize=(name,args,context)=>{
    alive(context.signal);const run=runId&&owner.get('workflow-run:'+runId);if(!run)return;
    const step=run.workflow.steps.find(step=>step.id===context.stepId);
    if(!step||run.taskId!==taskId||run.cursor!==step.id)fail('workflow_binding_changed');
    if(['complete','partial','failed','cancelled'].includes(run.status))fail('workflow_step_closed');
    assertWorkflowCall(run.workflow,step,name,args);
  };
  const receipt=(adapter,data,context)=>{
    alive(context.signal);const id='workflow-receipt:'+randomUUID();
    owner.set(id,{id,projectId:service.projectId,taskId,runId,stepId:context.stepId??null,adapter,summary:oneLine(context.summary||adapter),observedAt:new Date().toISOString(),data:structuredClone(data)});return id;
  };
  const document=action=>async(args,context={})=>{
    authorize('documents.'+action,args,context);const file=relativeFile(args.path),workspace=await service.target(taskId);let result;
    if(action==='exists'){
      try{result={path:file,exists:(await lstat(await scopedFile(workspace,file))).isFile()};}
      catch(error){if(error.code!=='ENOENT')throw error;result={path:file,exists:false};}
    }else{
      const source=await readSource(workspace,file);result=action==='read'?source:{path:source.path,hash:source.hash};
    }
    return {ok:true,result,receipts:[receipt('documents.'+action,result,context)]};
  };
  const browserKey=`workflow-browser:${runId}:${taskId}`;
  async function snapshot(binding,context){
    alive(context.signal);if(typeof service.playwrightRequest!=='function'||typeof service.mcpRegistry!=='function')fail('workflow_browser_unavailable');
    const before=await service.playwrightRequest('check',binding,{signal:context.signal});
    if(before.tabId!==binding.tabId||before.documentId!==binding.documentId)fail('browser_document_changed');
    const result=await service.mcpRegistry().call('mcp__playwright__browser_snapshot',binding,{signal:context.signal});
    if(result?.ok===false||result?.isError)fail('workflow_browser_snapshot');
    const after=await service.playwrightRequest('check',binding,{signal:context.signal});
    if(after.tabId!==before.tabId||after.documentId!==before.documentId)fail('browser_document_changed');
    alive(context.signal);const text=textOf(result);if(!text.includes('### Snapshot'))fail('workflow_browser_snapshot');const header=text.split('### Snapshot')[0];
    const match=/^\s*- Page URL:\s*(\S+)\s*$/m.exec(header);
    return {tabId:before.tabId,documentId:before.documentId,url:match?.[1]??null,text,truncated:/snapshot truncated|tokens truncated|자 생략/i.test(text)};
  }
  const web={irreversible:()=>false,
    async read(args,context={}){
      authorize('web.read',args,context);if(typeof service.playwrightRequest!=='function')fail('workflow_browser_unavailable');
      const binding=await service.playwrightRequest('open',{url:args.url},{signal:context.signal});
      if(!binding?.tabId||!binding.documentId||binding.automation===false)fail('workflow_browser_unavailable');
      const observation=await snapshot({tabId:binding.tabId,documentId:binding.documentId},context);
      owner.set(browserKey,{tabId:observation.tabId,documentId:observation.documentId});
      return {ok:true,observation,receipts:[receipt('web.read',observation,context)]};
    },
    async verify(args,context={}){
      authorize('web.verify',args,context);
      if(!['text_present','element_visible','url_is'].includes(args.kind))fail('workflow_verify_unknown');
      const binding=owner.get(browserKey);if(!binding)fail('workflow_browser_missing');
      if(args.tabId&&args.tabId!==binding.tabId||args.documentId&&args.documentId!==binding.documentId)fail('workflow_browser_changed');
      const observation=await snapshot(binding,context),body=observation.text.includes('### Snapshot')?observation.text.slice(observation.text.indexOf('### Snapshot')+12):'';let verified=false;
      if(args.kind==='element_visible'){
        if(typeof args.role!=='string'||typeof args.name!=='string'||!args.role||!args.name)fail('workflow_verify_invalid');
        verified=body.split('\n').some(line=>{const match=/^\s*-\s+([a-z]+)\s+("(?:[^"\\]|\\.)*")/.exec(line);if(!match||match[1]!==args.role||/\[hidden\]/.test(line))return false;try{return JSON.parse(match[2])===args.name;}catch{return false;}});
      }else{
        if(typeof args.value!=='string'||!args.value)fail('workflow_verify_invalid');
        verified=args.kind==='text_present'?body.includes(args.value):observation.url===args.value;
      }
      const result={verified,...(!verified&&observation.truncated?{partial:true}:{})};
      return {ok:true,result,observation,receipts:[receipt('web.verify',{...result,observation},context)]};
    }
  };
  const terminal={irreversible:args=>irreversibleCommand(args?.script).matched,
    async run(args,context={}){
      authorize('terminal.run',args,context);
      alive(context.signal);if(!runId||!context.stepId)fail('workflow_step_missing');
      if(typeof args?.script!=='string'||!args.script.trim()||Object.keys(args).some(key=>!['script','profile','references'].includes(key)))fail('workflow_arguments_invalid');
      const key=`workflow-command:${runId}:${context.stepId}`,binding=stepCacheKey(context.stepId,args);let record=owner.get(key),action;
      if(record){
        if(record.binding!==binding||record.taskId!==taskId)fail('workflow_binding_changed');
        action=owner.get('setup-action:'+record.actionId);if(!action)fail('workflow_command_missing');
      }else{
        const workspace=await service.target(taskId),observations=new SourceObservations();
        const environment=await inspectEnvironment(workspace,{selectedShell:service.shellPreference()},context.signal);rememberEnvironment(observations,environment);
        const references=new Map(environment.references.map(ref=>[ref.path,ref]));
        for(const reference of args.references||[]){
          const source=await readSource(workspace,relativeFile(reference.path));
          if(reference.hash&&reference.hash!==source.hash)fail('source_stale');observations.observe(source);references.set(source.path,{path:source.path,hash:source.hash});
        }
        alive(context.signal);const refs=[...references.values()];
        action=await prepareSetupAction(service,taskId,{title:oneLine(context.summary||'워크플로우 명령').slice(0,120),kind:'configure',script:args.script,...(args.profile?{profile:args.profile}:{}),reason:oneLine(context.summary||'워크플로우의 현재 단계를 수행합니다.'),effects:'아래 명령에 따른 파일 변경과 외부 연결을 검토해 주세요.',verification:'실제 프로세스의 종료 코드와 출력을 확인합니다.',references:refs.slice(0,10)},observations,refs.slice(10),()=>authorize('terminal.run',args,context));
        const untrusted=owner.get('setting:after-edit-check-untrusted')||[];
        if(untrusted.includes(workspace)||environment.partial){action={...action,manifestChanged:true};owner.set('setup-action:'+action.id,action);}
        owner.set(key,{taskId,runId,stepId:context.stepId,binding,actionId:action.id});
      }
      const receipts=['setup-action:'+action.id];
      if(action.state==='proposed'&&!terminal.irreversible(args)){
        const automatic=await service.autoApprovals({taskId});alive(context.signal);
        if(automatic.command?.kind==='setup'&&automatic.command.id===action.id)action=await service.decideSetupAction({id:action.id,fingerprint:action.fingerprint,decision:'approve'});
      }
      if(action.state==='rejected')return {ok:false,error:'workflow_command_rejected',receipts};
      if(action.state==='stale')return {ok:false,error:'workflow_command_changed',receipts};
      if(['attention','starting'].includes(action.state))return {ok:false,waiting:true,execution:'unconfirmed',error:'execution_unconfirmed',receipts};
      if(action.state!=='started')return {ok:false,waiting:true,error:'approval_required',receipts};
      const process=owner.get('process:'+action.resultProcessId);
      if(!process||process.execution==='unknown'||process.state==='interrupted')return {ok:false,waiting:true,execution:'unconfirmed',error:'execution_unconfirmed',receipts};
      receipts.push('process:'+process.id);
      if(!['completed','failed','cancelled','timed_out'].includes(process.state))return {ok:false,waiting:true,error:'process_running',receipts};
      const raw=String(process.output||''),output=Buffer.from(raw).subarray(0,8192).toString('utf8').replace(/\uFFFD$/,'');
      const result={processId:process.id,exitCode:process.exitCode,output,outputTruncated:Buffer.byteLength(raw)>8192};
      receipts.push(receipt('terminal.run',result,context));
      return {ok:process.state==='completed'&&process.exitCode===0,result,receipts,...(process.state==='completed'&&process.exitCode===0?{}:{error:'workflow_command_failed'})};
    }
  };
  return {web,terminal,documents:{read:document('read'),exists:document('exists'),hash:document('hash'),irreversible:()=>false}};
}

export function createSyntheticAdapters(fixture={}){
  return Object.fromEntries(Object.entries(ADAPTER_CATALOG).map(([adapter,actions])=>[adapter,{
    ...Object.fromEntries(actions.map(action=>[action,async(_args,{stepId,signal}={})=>{
      signal?.throwIfAborted();if(!Object.hasOwn(fixture.responses||{},stepId))return {ok:false,error:'workflow_fixture_missing',receipts:[]};
      return structuredClone(fixture.responses[stepId]);
    }])),irreversible:adapter==='terminal'?args=>irreversibleCommand(args?.script).matched:()=>false
  }]));
}
