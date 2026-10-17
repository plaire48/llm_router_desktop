// User edits change an unapproved draft only. IDs resolve against host-owned
// observations; a renderer cannot submit Office targets, methods or checks.
import {nativeDocumentPreview} from './native-document-preview.mjs';
import {hash,fail} from './files.mjs';
const signature=s=>JSON.stringify([s.target??'document',s.member,s.args??[]]);
export function applyNativeOfficeDraft(app,observation,base,changes){
 if(!Array.isArray(changes)||changes.length>100)fail('native_office_draft_invalid');
 const targets=nativeDocumentPreview(app,observation,base).editTargets,byId=new Map(targets.map(t=>[t.id,t])),args=structuredClone(base),seen=new Set();
 for(const change of changes){
  if(!change||Object.keys(change).some(k=>!['id','value'].includes(k))||seen.has(change.id))fail('native_office_draft_invalid');seen.add(change.id);const target=byId.get(change.id);if(!target)fail('native_office_draft_target_changed');
  let value=change.value;
  if(target.field==='text'){
   if(typeof value!=='string'||value.length>16000)fail('native_office_draft_value_invalid');
   // Native paragraph/cell terminators stay part of the bounded Word range.
   if(app==='word'){const suffix=target.value.match(/(?:\r?\x07|\r)$/)?.[0]||'';value=value.replace(/\r\n?/g,'\n').replace(/\n/g,'\r');if(suffix&&!value.endsWith(suffix))value=value.replace(/[\r\x07]+$/,'')+suffix;}
  }else if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>20000||['width','height'].includes(target.field)&&value<1)fail('native_office_draft_value_invalid');
  const id=signature(target.read),step=args.steps.find(s=>s.action==='set'&&signature(s)===id);
  if(step)step.value=value;else args.steps.push({...target.read,action:'set',value});
  let checked=false;for(const check of args.checks)if(signature(check.read)===id){check.equals=value;checked=true;}
  if(!checked)args.checks.push({read:structuredClone(target.read),equals:value});
 }
 if(args.steps.length>100||args.checks.length>100||JSON.stringify(args).length>39000)fail('native_office_approval_limit');
 return {args,hash:hash(JSON.stringify(args))};
}
