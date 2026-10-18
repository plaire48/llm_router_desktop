import {completionChecks} from './workflow-completion.mjs';
import {expandStepTools} from './workflow-tools.mjs';
import {parse} from 'yaml';
import {validateWorkflow} from './workflow-schema.mjs';
import {parseWorkflowAdapter} from './workflow-adapter-id.mjs';
import {importFail as fail,importField as field,importRecord as record,normalizeImportIds} from './workflow-import-common.mjs';
const array=(value,fallback=[])=>{if(value===undefined)return fallback;if(!Array.isArray(value))fail('workflow_import_invalid');return value;};
function schemaOf(value){
 if(value!==undefined&&(!record(value)||!Array.isArray(value.fields)))fail('workflow_import_invalid');
 const properties={},required=[];for(const f of array(value?.fields)){
  if(!record(f))fail('workflow_import_invalid');const id=field(f.id);if(Object.hasOwn(properties,id))fail('workflow_import_invalid');
  if(!['string','number','integer','boolean','object','array','enum'].includes(f.type))fail('workflow_import_unsupported');
  const property={type:f.type==='enum'?'string':f.type};if(f.type==='enum'){const options=array(f.enum_values);if(!options.length||options.some(v=>typeof v!=='string')||new Set(options).size!==options.length)fail('workflow_import_invalid');property.enum=options;}
  if(f.description||f.name)property.description=f.description||f.name;if(f.type==='array')property.items={};properties[id]=property;if(f.required)required.push(id);
 }return {type:'object',properties,required,additionalProperties:false};
}
const time=value=>{if(!value)return null;const n=value.basis==='actual'?value.actual_minutes:value.basis==='workload'?value.workload_minutes:null;if(n===null||n===undefined)return null;if(!Number.isFinite(n)||n<0)fail('workflow_import_invalid');return n;};
export function readBlueprint(value){
 let source=value;if(typeof source==='string')try{source=parse(source,{maxAliasCount:100});}catch{fail('workflow_import_invalid');}
 if(!record(source))fail('workflow_import_invalid');const flows=array(source.workflows);if(flows.some(f=>!record(f)))fail('workflow_import_invalid');let flow;
 if(source.start_workflow_id)flow=flows.find(f=>f.id===source.start_workflow_id);else if(flows.length===1)flow=flows[0];else fail('workflow_import_ambiguous');if(!record(flow))fail('workflow_import_reference');
 const nodes=array(flow.nodes),edges=array(flow.edges);if(!nodes.length||nodes.length>1000||edges.length>4000)fail('workflow_import_invalid');const ids=normalizeImportIds(nodes),byId=new Map(nodes.map(n=>[n.id,n])),out=new Map(nodes.map(n=>[n.id,[]]));
 for(const edge of edges){if(!record(edge)||!byId.has(edge.source)||!byId.has(edge.target))fail('workflow_import_reference');out.get(edge.source).push(edge.target);}
 return {source,flow,nodes,edges,ids,byId,out};
}
export function blueprintControlErrors({nodes,edges,byId,out}){
 const errors=[],seen=new Set(),add=(nodeId,kind)=>{const key=JSON.stringify([nodeId,kind]);if(seen.has(key))return;seen.add(key);const reasons={parallel:'병렬 구간은 1단계에서 실행하지 못해요. 순서를 정해 하나의 경로로 바꾸거나 2단계를 기다려 주세요.',join:'여러 병렬 경로를 기다리는 합류는 2단계에서 지원할 예정이에요.',loop:'반복 구간은 1단계에서 실행하지 못해요. 반복을 제거하거나 2단계를 기다려 주세요.',for_each:'항목별 반복은 2단계에서 지원할 예정이에요.',edge_condition:'분기 case 밖의 간선 조건은 실행하지 못해요. 명시적인 조건 분기로 옮겨 주세요.'};errors.push({code:'workflow_import_unsupported',nodeId,kind,message:reasons[kind]});};
 for(const node of nodes){if(node.type!=='branch')continue;const kind=node.logic_type;if(['parallel','join','loop','for_each'].includes(kind))add(node.id,kind);if(node.loop===true)add(node.id,'loop');if(array(node.cases).some(c=>record(c)&&c.join))add(node.id,'join');}
 for(const edge of edges){if(edge.condition===undefined||edge.condition===null||typeof edge.condition==='string'&&!edge.condition.trim())continue;const node=byId.get(edge.source),caseCondition=node.type==='branch'&&['if_else','switch'].includes(node.logic_type||'if_else')&&array(node.cases).some(c=>record(c)&&c.target_node_id===edge.target&&c.value===edge.condition);if(!caseCondition)add(node.id,'edge_condition');}
 const active=[],done=new Set();function visit(id){const start=active.indexOf(id);if(start>=0){for(const member of active.slice(start))add(member,'loop');return;}if(done.has(id))return;active.push(id);for(const to of out.get(id))visit(to);active.pop();done.add(id);}for(const node of nodes)visit(node.id);
 return errors;
}
// A display model of the original graph, never an executable workflow definition.
export function previewBlueprint(value){
 const parsed=readBlueprint(value),{flow,nodes,edges,ids}=parsed,tasks=array(flow.tasks),laneIds=normalizeImportIds(tasks);
 let errors=blueprintControlErrors(parsed);if(!errors.length)try{convertBlueprint(value);}catch(error){errors=error.errors||[{code:error.message,message:'이 Blueprint는 실행 초안으로 변환하지 못해요. 원본을 확인해 주세요.'}];}
 const kinds={agent:'agent',skill:'agent',api_mcp:'tool',file_search:'agent',human_approval:'human'};
 return {previewOnly:true,errors,workflow:{name:flow.name||'Blueprint 원본',lanes:tasks.map(t=>({id:laneIds.get(t.id),name:t.name||t.id})),steps:nodes.map(n=>({id:ids.get(n.id),sourceId:n.id,name:n.name||n.id,kind:n.type==='branch'?(['parallel','loop','for_each'].includes(n.logic_type)?n.logic_type==='for_each'?'loop':n.logic_type:'branch'):n.type==='action'?kinds[n.module?.type]||'human':n.type,lane:laneIds.get(n.task_id),next:null}))},edges:edges.map((edge,index)=>({id:'original-'+index,source:ids.get(edge.source),target:ids.get(edge.target),...(edge.label||edge.condition?{label:String(edge.label||edge.condition).slice(0,120)}:{})}))};
}
export function convertBlueprint(value){
 const parsed=readBlueprint(value),{source,flow,nodes,edges,ids,byId,out}=parsed,warnings=[];
 const errors=blueprintControlErrors(parsed);if(errors.length)throw Object.assign(Error('workflow_import_unsupported'),{errors});
 const warn=(node,code,message)=>warnings.push({nodeId:node.id,code,message});
 const tasks=array(flow.tasks),laneIds=normalizeImportIds(tasks),lanes=tasks.map(t=>({id:laneIds.get(t.id),name:t.name||t.id}));
 const roleItems=array(source.roles),roleIds=normalizeImportIds(roleItems),roles=roleItems.map(r=>({id:roleIds.get(r.id),name:r.name||r.id})),formBindings=[];
 const notes=nodes.filter(n=>n.type==='memo').map(n=>({nodeId:ids.get(n.id),content:n.content||n.name||''}));
 const skipped=n=>n.type==='memo'||n.type==='event'&&['start','schedule','end'].includes(n.event_type);
 function destination(id,seen=new Set()){
  if(id===null)return null;const n=byId.get(id);if(!n||seen.has(id))fail('workflow_import_reference');if(!skipped(n))return ids.get(id);if(n.event_type==='end'){if(out.get(id).length)fail('workflow_import_unsupported');return null;}
  if(out.get(id).length>1)fail('workflow_import_unsupported');return out.get(id).length?destination(out.get(id)[0],new Set([...seen,id])):null;
 }
 const inputSchema=schemaOf(flow.input_schema),inputs=Object.fromEntries(Object.entries(inputSchema.properties).map(([id,property])=>[id,{...property,required:inputSchema.required.includes(id)}]));
 const references=[];
 const outputs=new Map(nodes.filter(n=>n.type==='action').map(n=>[n.id,schemaOf(n.module?.output_schema||n.output_schema)]));
 function reference(text){
  if(typeof text!=='string')fail('workflow_import_reference');const member=/^\$\.nodes\.([\p{L}\p{N}_-]+)\.output\.([A-Za-z_][A-Za-z0-9_-]*)$/u.exec(text);
  if(member){const id=member[1],key=field(member[2]);if(!ids.has(id)||!Object.hasOwn(outputs.get(id)?.properties||{},key))fail('workflow_import_reference');references.push({id,key});return {expression:`steps.${ids.get(id)}.output.${key}`,schema:outputs.get(id).properties[key],required:outputs.get(id).required.includes(key)};}
  const root=/^\$\.([A-Za-z_][A-Za-z0-9_-]*)$/.exec(text);if(root){const key=field(root[1]);if(!Object.hasOwn(inputs,key))fail('workflow_import_reference');return {expression:'inputs.'+key,schema:inputs[key],required:inputs[key].required};}
  fail('workflow_import_reference');
 }
 const dataFor=n=>{const mappings=new Map();for(const m of [...array(n.input_mapping),...array(n.module?.input_mapping)]){if(!record(m)||typeof m.target_field!=='string'||!m.target_field)fail('workflow_import_invalid');if(mappings.has(m.target_field)&&mappings.get(m.target_field)!==m.source)fail('workflow_import_ambiguous');mappings.set(m.target_field,m.source);}return [...mappings].map(([target,source])=>({field:target,source:'{{ '+reference(source).expression+' }}'}));};
 const used=new Set(ids.values()),steps=[],sourceSteps=new Map();let externalWrite=false;
 function common(n){const targets=out.get(n.id);if(n.type!=='branch'&&targets.length>1)fail('workflow_import_unsupported');let lane;if(n.task_id){if(!laneIds.has(n.task_id))fail('workflow_import_reference');lane=laneIds.get(n.task_id);}const assigned=[...new Set([...(n.role_id?[n.role_id]:[]),...array(n.role_ids)])];if(assigned.some(id=>!roleIds.has(id)))fail('workflow_import_reference');return {...(assigned.length?{roles:assigned.map(id=>roleIds.get(id))}:{}),id:ids.get(n.id),name:n.name||n.id,...(lane?{lane}:{}),next:targets.length?destination(targets[0]):null};}
 function manual(n,base,message){warn(n,'workflow_import_module_unsupported',message);return {...base,kind:'human',ask:(n.name||n.id)+'\n'+message,outputs:{decision:['approve','stop']}};}
 for(const n of nodes){
  if(skipped(n))continue;const base=common(n);let step;
  if(n.type==='branch'){
   if(!['if_else','switch'].includes(n.logic_type||'if_else'))fail('workflow_import_unsupported');
   else{
    const cases=array(n.cases);if(!cases.length||cases.length>16||cases.some(c=>!record(c)||typeof c.value!=='string'||!byId.has(c.target_node_id))||new Set(cases.map(c=>c.value)).size!==cases.length)fail('workflow_import_invalid');
    const ref=reference(n.source_field),hasDefault=Object.hasOwn(n,'default_target_id');
    if(!hasDefault&&(!ref.required||!Array.isArray(ref.schema.enum)||ref.schema.enum.length!==cases.length||ref.schema.enum.some(v=>!cases.some(c=>c.value===v))))fail('workflow_import_unsupported');
    const count=hasDefault?cases.length:Math.max(1,cases.length-1),branchIds=[base.id];for(let i=1;i<count;i++){let id=base.id.slice(0,30)+'-case-'+(i+1),suffix=1;while(used.has(id))id=base.id.slice(0,25)+'-case-'+(i+1)+'-'+(++suffix);used.add(id);branchIds.push(id);}
    for(let i=0;i<count;i++){const otherwise=i+1<count?branchIds[i+1]:hasDefault?destination(n.default_target_id):destination(cases.at(-1).target_node_id);const branch={...base,id:branchIds[i],kind:'branch',when:ref.expression+' == '+JSON.stringify(cases[i].value),then:destination(cases[i].target_node_id),else:otherwise};steps.push(branch);if(i===0)sourceSteps.set(n.id,branch);}
    continue;
   }
  }else if(n.type==='action'){
   const module=n.module===undefined?{}:n.module;if(!record(module)||module.ref!==undefined&&typeof module.ref!=='string')fail('workflow_import_invalid');const config=module.config===undefined?{}:module.config,output=outputs.get(n.id);if(!record(config)||config.args!==undefined&&!record(config.args))fail('workflow_import_invalid');
   if(n.form_binding){const f=n.form_binding;if(!record(f))fail('workflow_import_invalid');formBindings.push({nodeId:base.id,id:f.id,name:f.name,formType:f.form_type,...(f.schema_ref?{schemaRef:f.schema_ref}:{})});warn(n,'workflow_import_form_unregistered','원본의 양식 연결은 참고 정보입니다. 양식 지도를 등록하고 확인한 뒤 사용해 주세요.');}
   if(module.auth_binding)warn(n,'workflow_import_auth_binding','원본 인증 참조는 자동 적용하지 않습니다. 누비에 연결한 서버의 인증을 사용합니다.');
   if(module.compensation)warn(n,'workflow_import_compensation','자동 되돌림은 연결되지 않았습니다. 실패하면 직접 확인해 주세요.');
   const data=dataFor(n),goal=String(config.goal||n.description||n.name||n.id)+(data.length?'\n\n입력 참조 (데이터):\n'+JSON.stringify(data):'');
   const allowedConfig=module.type==='api_mcp'?['args','verify']:module.type==='guardrail'?['verify']:['goal','tools','done_when'];
   if(Object.keys(config).some(key=>!allowedConfig.includes(key)))step=manual(n,base,'자동으로 대응하지 못하는 모듈 설정이 있어요. 직접 확인해 주세요.');
   else if(module.type==='human_approval'||['approval','review'].includes(n.form_binding?.form_type))step={...base,kind:'human',ask:goal,outputs:{decision:['approve','stop']}};
   else if(module.type==='api_mcp'){
    const adapter=parseWorkflowAdapter(module.ref);if(adapter?.family!=='mcp')step=manual(n,base,'연결할 MCP 서버와 도구를 확인해 주세요.');
    else{externalWrite ||= module.effect==='write';step={...base,kind:'tool',adapter:module.ref,args:{...(config.args||{}),...Object.fromEntries(data.map(m=>[field(m.field),m.source]))},...(module.effect==='write'?{externalWrite:true}:{}),...(module.idempotency_key?{idempotency:module.idempotency_key}:{}),...(config.verify?{verify:config.verify}:{}),...(Object.keys(output.properties).length?{outputs:{schema:output}}:{})};}
   }else if(['agent','skill','file_search'].includes(module.type)){
    let tools=config.tools??(module.type==='skill'?['use_skill']:module.type==='file_search'?['wiki_query','source_search','read_source']:[]);
    if(!Array.isArray(tools)||tools.some(t=>typeof t!=='string'))fail('workflow_import_invalid');if(module.type==='skill')tools=[...new Set([...tools,'use_skill'])];
    const properties={...output.properties},required=[...output.required];let evidence='evidence';while(Object.hasOwn(properties,evidence))evidence='workflow_'+evidence;properties[evidence]={type:'array',items:{type:'string'}};
    const grounded=tools.some(t=>['wiki_query','ask_openwiki','read_personal_mail','read_source','source_search'].includes(t));if(grounded)required.push(evidence);
    step={...base,kind:'agent',goal:goal+(module.type==='skill'&&module.ref?'\n현재 프로젝트의 스킬 지침을 먼저 읽는다: '+module.ref:''),tools,done_when:config.done_when||{kind:'output_schema',evidence:{min:grounded?1:0,...(evidence!=='evidence'?{field:evidence}:{})}},outputs:{schema:{...output,properties,required}},budget:{calls:20,minutes:10},...(module.effect==='write'?{externalWrite:true}:{})};
    if(module.effect==='write'&&!config.done_when)step=manual(n,base,'쓰기 결과를 관찰할 완료 조건이 필요합니다. 직접 확인해 주세요.');else externalWrite ||= module.effect==='write';
   }else if(module.type==='guardrail'&&['file_exists','file_hash'].includes(config.verify?.kind)){const check=config.verify;step={...base,kind:'tool',adapter:check.kind==='file_exists'?'documents.exists':'documents.hash',args:{path:check.path},verify:check.kind==='file_exists'?{kind:'truthy'}:check};}
   else step=manual(n,base,'자동으로 대응하지 못하는 모듈입니다. 직접 확인해 주세요.');
  }else step=manual(n,base,'자동으로 대응하지 못하는 이벤트입니다. 직접 확인해 주세요.');
  steps.push(step);sourceSteps.set(n.id,step);
 }
 for(const ref of references){const producer=sourceSteps.get(ref.id);if(producer?.kind==='human'&&(ref.key!=='decision'||!outputs.get(ref.id)?.properties.decision?.enum||JSON.stringify(outputs.get(ref.id).properties.decision.enum)!==JSON.stringify(producer.outputs.decision)))fail('workflow_import_unsupported');}
 const starts=nodes.filter(n=>n.type==='event'&&['start','schedule'].includes(n.event_type));if(starts.length>1)fail('workflow_import_ambiguous');const incoming=new Set(edges.map(e=>e.target));const roots=nodes.filter(n=>!skipped(n)&&!incoming.has(n.id));let first=starts.length?destination(starts[0].id):roots.length===1?ids.get(roots[0].id):null;if(!first)fail('workflow_import_ambiguous');const firstIndex=steps.findIndex(s=>s.id===first);if(firstIndex<0)fail('workflow_import_reference');if(firstIndex)steps.unshift(...steps.splice(firstIndex,1));
 const actionNodes=nodes.filter(n=>n.type==='action');let expected=0,known=0;for(const n of actionNodes){let minutes=time(n.work_time);if(minutes===null){const values=array(n.target_systems).map(system=>{if(!record(system))fail('workflow_import_invalid');return time(system.work_time);}).filter(v=>v!==null);if(values.length)minutes=values.reduce((a,b)=>a+b,0);}if(minutes!==null){expected+=minutes;known++;}}
 const metrics={expectedMinutes:known?expected:null,partial:known<actionNodes.length},schedule=starts.find(n=>n.event_type==='schedule');
 if(schedule&&(typeof schedule.source!=='string'||!schedule.source.trim()))fail('workflow_import_unsupported');
 const observationTools=steps.flatMap(step=>[step.verify,step.done_when].filter(Boolean).flatMap(check=>completionChecks(check)).flatMap(check=>check.kind==='file_exists'?['documents.exists']:check.kind==='file_hash'?['documents.hash']:[]));
 const tools=[...observationTools,...new Set(steps.flatMap(s=>s.kind==='tool'?[s.adapter]:s.kind==='agent'?expandStepTools(s.tools).tools:[]))];
 const workflow={name:flow.name||source.name||'가져온 워크플로우',version:1,trigger:schedule?{kind:'routine',schedule:schedule.source}:{kind:'manual'},inputs,permissions:{tools,externalWrite:externalWrite?'ask':'never'},lanes,notes,metrics,blueprint:{id:source.id||'',version:String(source.version||''),workflowId:flow.id,roles,formBindings},steps};
 const checked=validateWorkflow(workflow);if(!checked.ok)throw Object.assign(Error(checked.errors[0].code),{errors:checked.errors});return {workflow,warnings,metrics};
}
