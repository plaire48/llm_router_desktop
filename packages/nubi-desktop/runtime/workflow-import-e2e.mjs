import {validateWorkflow} from './workflow-schema.mjs';
import {importFail as fail,importField as field,importRecord as record,normalizeImportIds as identifiers} from './workflow-import-common.mjs';
const collection=value=>value===undefined||Array.isArray(value)&&value.every(record);
export function convertE2eTask(value){
 let input=value;if(typeof input==='string')try{input=JSON.parse(input);}catch{fail('workflow_import_invalid');}
 if(!input||typeof input!=='object'||!Array.isArray(input.nodes)||!input.nodes.length||input.nodes.length>1000)fail('workflow_import_invalid');
 if(!collection(input.inputs_from)||input.nodes.some(node=>!record(node)||!collection(node.inputs)||!collection(node.outputs)||!collection(node.cases)))fail('workflow_import_invalid');
 const nodes=input.nodes,ids=identifiers(nodes),warnings=[],inputs={},byId=new Map(nodes.map((node,index)=>[node.id,{node,index}]));
 const warn=(node,code,message)=>warnings.push({nodeId:node.id,code,message});
 const target=id=>{if(typeof id!=='string'||!ids.has(id))fail('workflow_import_reference');return ids.get(id);};
 for(const entry of input.inputs_from||[]){const key=field(entry.id||entry.field||entry.name);const type=entry.type||'string';if(!['string','number','integer','boolean','object','array'].includes(type))fail('workflow_import_unsupported');inputs[key]={type,required:entry.required!==false,...(typeof entry.name==='string'?{description:entry.name}:{})};}
 const reference=(source,index)=>{
  if(typeof source!=='string')fail('workflow_import_reference');
  const node=/^\$\.nodes\.([\p{L}\p{N}_-]+)\.output\.([A-Za-z_][A-Za-z0-9_-]*)$/u.exec(source);
  if(node){const original=byId.get(node[1]);if(!original||original.index>=index)fail('workflow_import_reference');const key=field(node[2]);if(!(original.node.outputs||[]).some(output=>(output.id||output.field)===key))fail('workflow_import_reference');return `{{ steps.${target(node[1])}.output.${key} }}`;}
  const root=/^\$\.([A-Za-z_][A-Za-z0-9_-]*)$/.exec(source);if(!root)fail('workflow_import_reference');const key=field(root[1]);if(key==='key'&&!Object.hasOwn(inputs,key))inputs[key]={type:'string',required:true};if(!Object.hasOwn(inputs,key))fail('workflow_import_reference');return `{{ inputs.${key} }}`;
 };
 const calls=input.max_auto_steps_per_pump??20;if(!Number.isSafeInteger(calls)||calls<1)fail('workflow_import_invalid');
 const steps=nodes.map((node,index)=>{
  if(Object.hasOwn(node,'next')&&node.next===null&&index!==nodes.length-1)fail('workflow_import_unsupported');
  const base={id:target(node.id),name:typeof node.name==='string'&&node.name.trim()?node.name:node.id,...(node.next!=null?{next:target(node.next)}:{})};
  const declaredInputs=(node.inputs||[]).map(entry=>{if(entry.when)fail('workflow_import_unsupported');return {field:entry.field,source:reference(entry.source,index)};});
  const data=declaredInputs.length?'\n\n입력 참조 (데이터):\n'+JSON.stringify(declaredInputs):'';
  if(node.type==='if')return {...base,kind:'branch',when:'false'}; // Resolved after all output schemas exist.
  const kind=node.action_type||node.type||'';
  const decide=/^decide[_-]/i.test(node.id)||['decision','llm_decision','llm_decision_output'].includes(kind);
  const write=/^file_change[_-]/i.test(node.id)||kind==='file_write';
  if(write&&typeof node.path!=='string'){warn(node,'workflow_import_file_path_missing','산출 파일 경로가 없어 사람이 직접 확인해야 합니다.');return {...base,kind:'human',ask:base.name+'\n파일 경로와 직접 수행한 결과를 확인해 주세요.'+data};}
  if(decide||write){
   const properties={},required=[];for(const output of node.outputs||[]){const name=field(output.id||output.field);if(Object.hasOwn(properties,name))fail('workflow_import_invalid');const type=output.type;if(type!==undefined&&!['string','number','integer','boolean','object','array'].includes(type))fail('workflow_import_unsupported');properties[name]={...(typeof output.name==='string'?{description:output.name}:{}),...(type?{type}:{})};required.push(name);}
   if(!required.length){properties.summary={type:'string'};required.push('summary');}
   let evidence='evidence';while(Object.hasOwn(properties,evidence))evidence='workflow_'+evidence;
   properties[evidence]={type:'array',items:{type:'string'}};if(decide)required.push(evidence);
   if(node.labels?.length){if(!Array.isArray(node.labels)||node.labels.some(label=>typeof label!=='string'))fail('workflow_import_invalid');const output=(node.outputs||[])[0];if(output)properties[output.id||output.field]={...properties[output.id||output.field],enum:node.labels};}
   const outputPath=write?(node.path.startsWith('$')?reference(node.path,index):node.path.replaceAll('\\','/')):null;
   if(write&&!node.path.startsWith('$')&&(!outputPath||outputPath.startsWith('/')||/^[A-Za-z]:/.test(outputPath)||outputPath.split('/').some(part=>!part||part==='..'||part==='.')||outputPath.includes('\0')))fail('workflow_import_reference');
   const done_when=write?{kind:'file_exists',path:outputPath}:{kind:'output_schema',evidence:{min:1,...(evidence!=='evidence'?{field:evidence}:{})}};
   return {...base,kind:'agent',goal:base.name+data+(node.prompt_file?'\n지침 파일 (현재 프로젝트에서 먼저 읽기): '+node.prompt_file:''),tools:write?['propose_new_file','propose_patch','read_source']:['read_source','source_search'],done_when,outputs:{schema:{type:'object',required,properties,additionalProperties:false}},budget:{calls:Math.min(60,calls),minutes:10}};
  }
  if(!['confirm','human','human_approval','ask_user','consult','notify_receive'].includes(kind))warn(node,'workflow_import_unknown_node','자동으로 대응하지 못하는 작업입니다. 사람이 직접 확인해야 합니다.');
  return {...base,kind:'human',ask:base.name+data,outputs:{decision:['approve','stop']}};
 });
 for(const [index,node] of nodes.entries())if(node.type==='if'){
  const cases=node.cases;if(!Array.isArray(cases)||cases.length!==2)fail('workflow_import_unsupported');
  const source=byId.get(node.source_node);if(!source||source.index>=index)fail('workflow_import_reference');const producer=steps[source.index];if(producer.kind!=='agent')fail('workflow_import_unsupported');
  const key=field(node.source_field||(source.node.outputs||[])[0]?.id);if(!Object.hasOwn(producer.outputs.schema.properties,key))fail('workflow_import_reference');
  for(const entry of cases)if(!['string','number','boolean'].includes(typeof entry.value))fail('workflow_import_unsupported');
  if(cases[0].value===cases[1].value)fail('workflow_import_invalid');
  const output=producer.outputs.schema.properties[key],values=cases.map(entry=>entry.value);
  if(values.some(value=>output.type&&!(output.type===typeof value||output.type==='integer'&&Number.isInteger(value)))||output.enum&&(output.enum.length!==values.length||output.enum.some(value=>!values.includes(value))))fail('workflow_import_unsupported');
  producer.outputs.schema.properties[key]={...output,enum:values};
  steps[index]={...steps[index],when:`steps.${target(node.source_node)}.output.${key} == ${JSON.stringify(cases[0].value)}`,then:target(cases[0].next||cases[0].target||cases[0].target_node_id),else:target(cases[1].next||cases[1].target||cases[1].target_node_id)};
 }
 // Manual placeholders cannot manufacture the named structured outputs of the old engine.
 for(const [index,node] of nodes.entries())for(const entry of node.inputs||[]){const match=/^\$\.nodes\.([\p{L}\p{N}_-]+)\.output\.([A-Za-z_][A-Za-z0-9_-]*)$/u.exec(entry.source);if(match&&steps[byId.get(match[1]).index].kind==='human'&&match[2]!=='decision')fail('workflow_import_unsupported');}
 const workflow={name:input.task_name||input.name||'가져온 워크플로우',version:1,trigger:{kind:'manual'},inputs,permissions:{tools:['documents','wiki'],externalWrite:'never'},steps};
 const checked=validateWorkflow(workflow);if(!checked.ok)throw Object.assign(Error(checked.errors[0].code),{errors:checked.errors});return {workflow,warnings};
}
