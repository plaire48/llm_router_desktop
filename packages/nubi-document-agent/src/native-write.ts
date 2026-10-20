import {abortable,canonical,clone,fail,validId} from './contracts.js';
import type {Scope} from './types.js';

export interface NativeOfficeStep {target?:string;id?:string;action:'get'|'set'|'call';member:string;args?:unknown[];value?:unknown}
export interface NativeOfficeCheck {read:NativeOfficeStep;equals:unknown}
export interface NativeOfficeWriteConnection {
 environment:'fixture'|'windows-office';app:'word'|'excel'|'powerpoint';scope:Scope;documentId:string;officeSessionId:string;
 /** Existing bound native host owns CheckSource, STA serialization, preparation and approval. */
 call(name:'inspect_office'|'execute_office_operations'|'calculate_office',input:Record<string,unknown>,signal:AbortSignal):Promise<unknown>;
}
export interface NativeOfficeWriteRequest {summary:string;observe:NativeOfficeStep[];steps:NativeOfficeStep[];checks:NativeOfficeCheck[];afterChecks?:NativeOfficeCheck[];calculateTarget?:string;expectedObservation?:{snapshotId:string;results:unknown[]}}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const forbidden=/^(?:Application|Parent|GetType|Evaluate|VBProject|VBE|Run|Open|Save|SaveAs|SaveAs2|SaveCopyAs|Close|Quit|ExportAsFixedFormat|FollowHyperlink)$/i;
function step(value:NativeOfficeStep,readOnly=false){
 if(record(value)&&value.action==='set'&&(!Object.hasOwn(value,'value')||value.value===undefined))fail('native_write_input_invalid');
 if(!record(value)||Object.keys(value).some(k=>!['target','id','action','member','args','value'].includes(k))||!['get','set','call'].includes(value.action)||typeof value.member!=='string'||value.member.length>100||!value.member.split('.').every(part=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)&&!forbidden.test(part))||value.member.split('.').length>8||readOnly&&value.action!=='get'||value.target!==undefined&&(typeof value.target!=='string'||value.target.length>160||value.target.split('.').some(part=>forbidden.test(part)))||value.id!==undefined&&!validId(value.id)||value.args!==undefined&&(!Array.isArray(value.args)||value.args.length>32))fail('native_write_input_invalid');
}
function checks(values:NativeOfficeCheck[]){if(!Array.isArray(values)||!values.length||values.length>100)fail('native_write_input_invalid');for(const check of values){if(!record(check)||Object.keys(check).some(k=>!['read','equals'].includes(k))||!Object.hasOwn(check,'equals')||check.equals===undefined)fail('native_write_input_invalid');step(check.read,true);}}
export function validateNativeOfficeReadSteps(steps:NativeOfficeStep[]){if(!Array.isArray(steps)||!steps.length||steps.length>100||canonical(steps).length>180000)fail('native_write_input_invalid');for(const s of steps)step(s,true);}
/** One transaction on a host-bound Office session. Never starts Office or owns approval/save. */
export function createNativeOfficeWritePort(connection:NativeOfficeWriteConnection){
 if(!connection||!['fixture','windows-office'].includes(connection.environment)||!['word','excel','powerpoint'].includes(connection.app)||!validId(connection.scope?.projectId)||!validId(connection.scope?.taskId)||!validId(connection.documentId)||!validId(connection.officeSessionId)||typeof connection.call!=='function')fail('native_write_connection_invalid');
 const binding=()=>({environment:connection.environment,app:connection.app,scope:connection.scope,documentId:connection.documentId,officeSessionId:connection.officeSessionId}),original=canonical(binding()),bound=clone(binding()),nativeCall=connection.call.bind(connection),control=new AbortController();let consumed=false,closed=false;
 return {
  close(){closed=true;control.abort();},
  async write(input:NativeOfficeWriteRequest,external:AbortSignal){
   if(closed)fail('native_connection_closed');if(consumed)fail('native_write_consumed');if(original!==canonical(binding()))fail('native_write_binding_changed');
   if(!record(input)||Object.keys(input).some(k=>!['summary','observe','steps','checks','afterChecks','calculateTarget','expectedObservation'].includes(k))||typeof input.summary!=='string'||!input.summary.trim()||input.summary.length>2000||canonical(input).length>180000||!Array.isArray(input.observe)||!input.observe.length||input.observe.length>100||!Array.isArray(input.steps)||!input.steps.length||input.steps.length>100)fail('native_write_input_invalid');
   if(input.expectedObservation&&(!record(input.expectedObservation)||Object.keys(input.expectedObservation).some(k=>!['snapshotId','results'].includes(k))||!validId(input.expectedObservation.snapshotId)||!Array.isArray(input.expectedObservation.results)||input.expectedObservation.results.length!==input.observe.length))fail('native_write_input_invalid');
   for(const s of input.observe)step(s,true);for(const s of input.steps)step(s);if(!input.steps.some(s=>s.action!=='get'))fail('native_write_input_invalid');checks(input.checks);if(input.afterChecks)checks(input.afterChecks);
   if(input.calculateTarget!==undefined&&(connection.app!=='excel'||!validId(input.calculateTarget)))fail('native_write_input_invalid');
   const request=clone(input),signal=AbortSignal.any([external,control.signal]);if(signal.aborted)fail('operation_cancelled');consumed=true;
   let dispatched=false,mutated=false,completedWrites=0,writeResultUncertain=false;
   const result=(status:string,error?:string)=>({status,...(error?{error}:{}),environment:bound.environment,app:bound.app,savedToOffice:false as const,office2016Verified:false as const,nascaVerified:false as const,writeDispatched:dispatched,mutated,completedWrites,writeResultUncertain});
   const call=async(name:Parameters<NativeOfficeWriteConnection['call']>[0],payload:Record<string,unknown>)=>{
    if(signal.aborted)fail('operation_cancelled');if(original!==canonical(binding()))fail('native_write_binding_changed');
    const response=await abortable(nativeCall(name,payload,signal),signal);if(signal.aborted)fail('operation_cancelled');if(original!==canonical(binding()))fail('native_write_binding_changed');
    if(!record(response)||canonical(response).length>240000)fail('native_write_response_invalid');return response;
   };
   try{
    const before=await call('inspect_office',{steps:request.observe});if(before.error||before.ok===false||!validId(before.snapshotId)||!Array.isArray(before.results)||before.results.length!==request.observe.length)fail('native_write_observation_invalid');
    if(request.expectedObservation&&canonical(before.results)!==canonical(request.expectedObservation.results))fail('native_write_source_changed');
    dispatched=true;writeResultUncertain=true;
    const receipt=await call('execute_office_operations',{snapshotId:before.snapshotId,summary:request.summary,steps:request.steps,checks:request.checks});
    mutated=receipt.mutated===true;completedWrites=Number.isSafeInteger(receipt.completedWrites)?receipt.completedWrites as number:0;
    writeResultUncertain=receipt.writeResultUncertain!==false;
    if(receipt.status!=='verified'){
     if(!mutated&&completedWrites===0&&!writeResultUncertain&&['rejected','conflict','cancelled'].includes(String(receipt.status)))return result(String(receipt.status),typeof receipt.error==='string'?receipt.error:undefined);
     return result('uncertain','native_write_incomplete');
    }
    if(!mutated||completedWrites<1||writeResultUncertain||receipt.saved!==false||!Array.isArray(receipt.checks)||receipt.checks.length<request.checks.length||receipt.checks.some(c=>!record(c)||c.passed!==true)){writeResultUncertain=true;return result('uncertain','native_write_receipt_invalid');}
    if(bound.app==='excel'){
     if(!request.calculateTarget)return result('needs_review','native_calculation_required');
     const calculated=await call('calculate_office',{target:request.calculateTarget});if(calculated.status!=='calculated'||calculated.calculationDone!==true)return result('needs_review','native_calculation_pending');
    }
    const afterChecks=[...request.checks,...request.afterChecks??[]],after=await call('inspect_office',{steps:afterChecks.map(c=>c.read)});
    if(after.error||after.ok===false||!validId(after.snapshotId)||!Array.isArray(after.results)||after.results.length!==afterChecks.length)fail('native_write_observation_invalid');
    if(afterChecks.some((c,i)=>canonical(c.equals)!==canonical((after.results as unknown[])[i])))return result('needs_review','native_write_readback_mismatch');
    return {...result('verified_unsaved'),beforeSnapshotId:before.snapshotId,afterSnapshotId:after.snapshotId,checksVerified:afterChecks.length,calculationDone:bound.app==='excel'};
   }catch(error){
    if(!dispatched)throw error;
    writeResultUncertain=true;return result('uncertain',signal.aborted?'operation_cancelled':'native_write_response_unconfirmed');
   }
  }
 };
}
