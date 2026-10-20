import type { Binding, Block, DocumentContext, Host, Json, Scope, Snapshot } from './types.js';
import { abortable, canonical, clone, DocumentAgentError, fail, fingerprint, sameDocument, validId, validateSnapshot } from './contracts.js';

export type NativeReadTool = 'inspect_office' | 'inspect_office_members';
export interface NativeWordConnection {
  scope: Scope; targetRef: string; leaseId: string; app: 'word'; officeSessionId: string; documentId: string;
  range: {start:number;end:number;storyType:1};
  /** Reuse the bound Office X native caller; it must fence source identity and serialize UI/STA access. */
  call(name: NativeReadTool, input: Record<string,unknown>, signal: AbortSignal): Promise<unknown>;
}
export interface NativeWordBridge {
  environment: 'fixture' | 'windows-office';
  acquire(scope: Scope, targetRef: string, signal: AbortSignal): Promise<NativeWordConnection>;
  release(connection: NativeWordConnection): Promise<void>;
}
export interface OfficeMember {
  name:string; action:'get'|'set'|'call'; parameterCount:number; optionalParameters:number;
  parameters:string[]; readOnlyCall:boolean;
}
export type MemberInfo = {status:'available';source:'live_office_type_info';members:OfficeMember[]} |
  {status:'unavailable';source:'unavailable';members:[]};
export interface WordReadEvidence {
  environment: NativeWordBridge['environment']; memberMetadata:'available'|'unavailable'|'not_queried';
  consistency:'not_checked'|'two_pass_match'; scope:'selected_main_story_range';
  nativeSnapshotIds:string[]; characters:number; paragraphs:number;
}
interface Step {id?:string;target:string;action:'get';member:string;args?:number[]}
interface Lease {
  connection:NativeWordConnection; resource:NativeWordConnection; context:DocumentContext; control:AbortController;
  prefix:string; rangeHandle?:string; busy:boolean; evidence:WordReadEvidence;
}
const maxCharacters = 512;
const fontFields = ['Name','Size','Bold','Italic','Underline','Color'] as const;
const paragraphFields = ['Alignment','SpaceBefore','SpaceAfter','LeftIndent','RightIndent'] as const;
const get = (target:string,member:string,id?:string,args?:number[]):Step => ({target,action:'get',member,...(id?{id}:{}),...(args?{args}:{})});
const record = (x:unknown): x is Record<string,unknown> => !!x && typeof x==='object' && !Array.isArray(x);

/** Read-only sub-port. It deliberately has no apply, save, or open operation. */
export function createNativeWordReadPort(bridge: NativeWordBridge) {
  if (!bridge || !['fixture','windows-office'].includes(bridge.environment) || typeof bridge.acquire!=='function' || typeof bridge.release!=='function') fail('native_bridge_invalid');
  const leases = new Map<string,Lease>();
  function lease(ctx: DocumentContext): Lease {
    const value=leases.get(ctx?.leaseId);
    if (!value || value.control.signal.aborted || canonical(ctx.scope)!==canonical(value.context.scope) || !sameDocument(ctx.binding,value.context.binding)) fail('native_lease_invalid');
    return value;
  }
  function signalFor(value: Lease, signal: AbortSignal): AbortSignal { return AbortSignal.any([signal,value.control.signal]); }
  async function call(value:Lease,name:NativeReadTool,input:Record<string,unknown>,signal:AbortSignal):Promise<Record<string,unknown>> {
    if(signal.aborted)fail('operation_cancelled');
    try {
      const result=await abortable(value.connection.call(name,input,signal),signal);
      if(signal.aborted)fail('operation_cancelled');
      if(!record(result)||canonical(result).length>240_000)fail('native_response_invalid');
      return result;
    } catch(error) {
      if(error instanceof DocumentAgentError)throw error;
      return fail('native_read_failed');
    }
  }
  async function members(value:Lease,target:'document'|'range',query:string,signal:AbortSignal):Promise<MemberInfo> {
    if(typeof query!=='string'||query.length>100||!/^[A-Za-z0-9_]*$/.test(query))fail('native_query_invalid');
    const handle=target==='document'?'document':value.rangeHandle;
    if(!handle)fail('native_range_not_observed');
    const response=await call(value,'inspect_office_members',{target:handle,query,count:200},signal);
    if(response.error==='office_member_metadata_unavailable') {
      value.evidence.memberMetadata='unavailable';return {status:'unavailable',source:'unavailable',members:[]};
    }
    if(response.error||response.ok===false||response.retrievedFrom!=='live_office_type_info'||!Array.isArray(response.members)||response.members.length>200)fail('native_member_response_invalid');
    const result: OfficeMember[]=[];
    for(const item of response.members){
      if(!record(item)||typeof item.name!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(item.name)||!['get','set','call'].includes(String(item.action))||!Number.isSafeInteger(item.parameterCount)||!Number.isSafeInteger(item.optionalParameters)||!Array.isArray(item.parameters)||item.parameters.length>32||item.parameters.some(x=>typeof x!=='string'||x.length>100)||typeof item.readOnlyCall!=='boolean')fail('native_member_response_invalid');
      result.push(clone(item) as unknown as OfficeMember);
    }
    value.evidence.memberMetadata='available';
    return {status:'available',source:'live_office_type_info',members:result};
  }
  async function inspect(value:Lease,steps:Step[],signal:AbortSignal):Promise<unknown[]> {
    const results:unknown[]=[];
    // Existing OfficeAutomationSession accepts at most 1,000 steps. Keep batches well below that bound.
    for(let i=0;i<steps.length;i+=256){
      const batch=steps.slice(i,i+256);
      const response=await call(value,'inspect_office',{steps:batch},signal);
      if(response.error||response.ok===false||!validId(response.snapshotId)||!Array.isArray(response.results)||response.results.length!==batch.length)fail('native_observation_invalid');
      value.evidence.nativeSnapshotIds.push(response.snapshotId);
      results.push(...response.results);
    }
    return results;
  }
  function numeric(x:unknown):number {if(typeof x!=='number'||!Number.isFinite(x))fail('native_style_incomplete');return x;}
  function font(values:unknown[]):Record<string,Json> {
    const [name,size,bold,italic,underline,color]=values;
    if(typeof name!=='string'||!name||name.length>200||![0,-1].includes(numeric(bold))||![0,-1].includes(numeric(italic)))fail('native_style_incomplete');
    if(numeric(size)<=0||numeric(size)>1638)fail('native_style_incomplete');
    return {name,fontSize:numeric(size),bold:bold===-1,italic:italic===-1,underline:numeric(underline),color:numeric(color)};
  }
  async function pass(value:Lease,signal:AbortSignal):Promise<Block[]> {
    const {start,end}=value.connection.range, root=value.prefix+'_range';
    const header=await inspect(value,[get('document','Range',root,[start,end]),get(root,'Text'),get(root,'Start'),get(root,'End'),get(root,'StoryType'),get(root,'Fields.Count'),get(root,'InlineShapes.Count'),get(root,'ContentControls.Count'),get(root,'Tables.Count')],signal);
    value.rangeHandle=root;
    const text=header[1];
    if(typeof text!=='string')fail('native_text_incomplete');
    if(header[2]!==start||header[3]!==end||text.length!==end-start)fail('native_range_mismatch');
    if(header[4]!==1||header.slice(5).some(x=>x!==0)||/[\n\t\u0000\u0007\u000b\u000c\u0013-\u0015]/.test(text))fail('native_scope_unsupported');
    const paragraphs:Array<{start:number;end:number;text:string;separator:string}>=[];
    let cursor=0;
    while(cursor<text.length){
      const marker=text.indexOf('\r',cursor),stop=marker<0?text.length:marker;
      paragraphs.push({start:start+cursor,end:start+stop,text:text.slice(cursor,stop),separator:marker<0?'':'\r'});
      cursor=stop+(marker<0?0:1);
    }
    if(!paragraphs.length||paragraphs.length>200)fail('native_scope_unsupported');
    const steps:Step[]=[], plans:Array<{paragraph:number;chars:Array<{text:string;offset:number} >}>=[];
    for(let p=0;p<paragraphs.length;p++){
      const paragraph=paragraphs[p],range=value.prefix+'_p'+p,format=range+'_format';
      steps.push(get('document','Range',range,[paragraph.start,paragraph.end]),get(range,'ParagraphFormat',format));
      const paragraphOffset=steps.length;for(const field of paragraphFields)steps.push(get(format,field));
      const chars:Array<{text:string;offset:number}>=[];
      let position=paragraph.start;
      // Empty paragraphs inspect the collapsed insertion range's formatting without changing it.
      for(const character of [...paragraph.text].length?[...paragraph.text]:['']){
        const charRange=value.prefix+'_c'+position,charFont=charRange+'_font';
        steps.push(get('document','Range',charRange,[position,position+character.length]),get(charRange,'Font',charFont));
        const offset=steps.length;for(const field of fontFields)steps.push(get(charFont,field));
        chars.push({text:character,offset});position+=character.length;
      }
      plans.push({paragraph:paragraphOffset,chars});
    }
    const values=await inspect(value,steps,signal),blocks:Block[]=[];
    for(let p=0;p<paragraphs.length;p++){
      const paragraph=paragraphs[p],plan=plans[p];
      const [alignment,before,after,left,right]=values.slice(plan.paragraph,plan.paragraph+5).map(numeric);
      const block:Block={id:'p'+(p+1),style:{alignment,spacingBefore:before,spacingAfter:after,leftIndent:left,rightIndent:right,paragraphTerminator:paragraph.separator},runs:[]};
      for(const character of plan.chars){
        const style=font(values.slice(character.offset,character.offset+6)),last=block.runs.at(-1);
        if(last&&canonical(last.style)===canonical(style))last.text+=character.text;
        else block.runs.push({id:block.id+':r'+(block.runs.length+1),text:character.text,style});
      }
      blocks.push(block);
    }
    return blocks;
  }
  const port={
    async acquire(scope:Scope,targetRef:string,signal:AbortSignal):Promise<{leaseId:string;binding:Binding}> {
      if(!validId(scope?.projectId)||!validId(scope?.taskId)||!validId(targetRef))fail('native_scope_invalid');
      if(signal.aborted)fail('operation_cancelled');
      const connection=await bridge.acquire(clone(scope),targetRef,signal);
      try {
        if(signal.aborted)fail('operation_cancelled');
        if(!connection||connection.app!=='word'||canonical(connection.scope)!==canonical(scope)||connection.targetRef!==targetRef||!validId(connection.leaseId)||leases.has(connection.leaseId)||!validId(connection.documentId)||!validId(connection.officeSessionId)||typeof connection.call!=='function')fail('native_connection_invalid');
        const r=connection.range;
        if(!r||r.storyType!==1||!Number.isSafeInteger(r.start)||!Number.isSafeInteger(r.end)||r.start<0||r.end<=r.start||r.end-r.start>maxCharacters)fail('native_scope_unsupported');
        const binding:Binding={app:'word',documentId:connection.documentId,officeSessionId:connection.officeSessionId,revision:'unobserved'};
        const ctx:DocumentContext={scope:clone(scope),leaseId:connection.leaseId,binding};
        leases.set(connection.leaseId,{connection:{...connection,scope:clone(scope),range:clone(r),call:connection.call.bind(connection)},resource:connection,context:ctx,control:new AbortController(),prefix:'nubi_'+crypto.randomUUID().replaceAll('-',''),busy:false,evidence:{environment:bridge.environment,memberMetadata:'not_queried',consistency:'not_checked',scope:'selected_main_story_range',nativeSnapshotIds:[],characters:r.end-r.start,paragraphs:0}});
        return {leaseId:connection.leaseId,binding:clone(binding)};
      } catch(error) {await bridge.release(connection);throw error;}
    },
    async read(ctx:DocumentContext,external:AbortSignal):Promise<Snapshot> {
      const value=lease(ctx),signal=signalFor(value,external);
      if(value.busy)fail('native_lease_busy');value.busy=true;
      value.evidence.consistency='not_checked';value.evidence.nativeSnapshotIds=[];value.evidence.paragraphs=0;
      try {
        await members(value,'document','Range',signal);
        const first=await pass(value,signal),second=await pass(value,signal);
        if(canonical(first)!==canonical(second))fail('native_source_changed');
        if(signal.aborted)fail('operation_cancelled');
        const revision=await fingerprint({app:'word',officeSessionId:value.context.binding.officeSessionId,documentId:value.context.binding.documentId,range:value.connection.range,blocks:second});
        if(signal.aborted)fail('operation_cancelled');
        const snapshot:Snapshot={binding:{...clone(value.context.binding),revision},blocks:second};validateSnapshot(snapshot);
        value.evidence.consistency='two_pass_match';value.evidence.paragraphs=second.length;
        return snapshot;
      } finally {value.busy=false;}
    },
    async inspectMembers(ctx:DocumentContext,input:{target:'document'|'range';query?:string},external:AbortSignal):Promise<MemberInfo> {
      const value=lease(ctx),signal=signalFor(value,external);
      if(!input||!['document','range'].includes(input.target))fail('native_query_invalid');
      if(value.busy)fail('native_lease_busy');value.busy=true;
      try {return await members(value,input.target,input.query??'',signal);} finally {value.busy=false;}
    },
    evidence(ctx:DocumentContext):WordReadEvidence {return clone(lease(ctx).evidence);},
    async release(ctx:DocumentContext):Promise<void> {
      const value=lease(ctx);leases.delete(ctx.leaseId);value.control.abort('released');
      await bridge.release(value.resource);
    }
  };
  return port satisfies Pick<Host['document'],'acquire'|'read'|'release'> & {inspectMembers:typeof port.inspectMembers;evidence:typeof port.evidence};
}
