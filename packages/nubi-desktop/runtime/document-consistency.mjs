import {readSource} from './files.mjs';
import {validateDocuments} from './chat-documents.mjs';
const ref={type:'object',additionalProperties:false,properties:{kind:{enum:['attachment','workspace']},id:{type:'string',maxLength:80},path:{type:'string',maxLength:1000},sourceHash:{type:'string',maxLength:100},start:{type:'integer',minimum:0},end:{type:'integer',minimum:1}},required:['kind','sourceHash','start','end']};
export const DOCUMENT_CONSISTENCY_TOOL={type:'function',function:{name:'compare_document_values',description:'Compare exact numeric ranges in 2-12 already identified document snapshots or project text files. Uses UTF-16 offsets and source hashes. Strict decimal/grouped numbers only. Label and unit are your interpretation, not host verified semantics. Does not recalculate Office formulas or verify whole documents. Attachments must belong to this task. Read sources first.',parameters:{type:'object',additionalProperties:false,properties:{label:{type:'string',minLength:1,maxLength:120},unit:{type:'string',maxLength:40},references:{type:'array',minItems:2,maxItems:12,items:ref}},required:['label','unit','references']}}};
function decimal(text){
 const value=text.trim();if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)||value.length>100)throw Error('document_value_ambiguous');
 const negative=value[0]==='-',raw=value.replace(/^[+-]/,'').replaceAll(',',''),[whole,fraction='']=raw.split('.'),a=whole.replace(/^0+(?=\d)/,''),b=fraction.replace(/0+$/,'');return (negative&&(a!=='0'||b)?'-':'')+a+(b?'.'+b:'');
}
export async function compareDocumentValues(service,task,args,signal){
 if(!args||typeof args.label!=='string'||!args.label.trim()||args.label.length>120||typeof args.unit!=='string'||args.unit.length>40||!Array.isArray(args.references)||args.references.length<2||args.references.length>12)throw Error('document_comparison_arguments');
 const store=service.store,projectId=service.projectId,root=await service.target(task.id),cache=new Map(),rows=[];
 for(const reference of args.references){
  signal.throwIfAborted();const {kind,id,path,sourceHash,start,end}=reference;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end-start>100)throw Error('document_value_range');
  const key=JSON.stringify([kind,kind==='attachment'?id:path]);let source=cache.get(key);
  if(!source){
   if(kind==='attachment'){
    validateDocuments(service,[{id,sourceHash}]);if(!task.documentReferences?.some(r=>r.id===id&&r.sourceHash===sourceHash))throw Error('document_scope');
    const record=store.get('chat-document:'+id);source={text:record.text,hash:record.hash,title:record.filename};
   }else if(kind==='workspace'){const file=await readSource(root,path);source={text:file.content,hash:file.hash,title:path};}
   else throw Error('document_scope');cache.set(key,source);
  }
  if(source.hash!==sourceHash)throw Error('source_stale');if(end>source.text.length)throw Error('document_value_range');
  // A substring of a larger number is not evidence for the requested value.
  if(/[\d.,+-]/.test(source.text[start-1]||'')||/[\d.,]/.test(source.text[end]||''))throw Error('document_value_boundary');
  const literal=source.text.slice(start,end),value=decimal(literal);rows.push({kind,...kind==='attachment'?{id}:{path},sourceHash,start,end,title:source.title,literal,value});
 }
 if(new Set(rows.map(r=>JSON.stringify([r.kind,r.id||r.path,r.start,r.end]))).size!==rows.length)throw Error('document_comparison_duplicate');
 // Revalidate asynchronous reads before recording a comparison of current project files.
 for(const row of rows.filter(r=>r.kind==='workspace'))if((await readSource(root,row.path)).hash!==row.sourceHash)throw Error('source_stale');
 signal.throwIfAborted();if(service.store!==store||service.projectId!==projectId)throw Error('project_changed');
 const result={label:args.label,unit:args.unit,status:new Set(rows.map(r=>r.value)).size===1?'matched':'mismatch',references:rows,checkedAt:new Date().toISOString(),scope:'literal_numeric_ranges',semanticEquivalenceVerified:false,instruction:'Exact numeric comparison only. Unit and meaning were supplied by the model. Preserve differences; never change an output just to make numbers agree. Attached snapshots are historical. Re-run after changes.'};
 const current=service.task(task.id);current.documentComparisons=[...(current.documentComparisons||[]),result].slice(-12);store.set('task:'+task.id,current);task.documentComparisons=current.documentComparisons;return result;
}
