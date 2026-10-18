import {parseWorkflowAdapter} from './workflow-adapter-id.mjs';
import {nextWorkflowStep,branchWorkflowStep} from './workflow-navigation.mjs';
import Ajv from 'ajv';
import {secretLike} from './secret-like.mjs';
import {expandStepTools} from './workflow-tools.mjs';
import {assertObservableCompletion} from './workflow-completion.mjs';
import {assertStepPermissions} from './workflow-policy.mjs';

const identifier={type:'string',pattern:'^[a-z][a-z0-9-]{0,39}$'};
const successor={anyOf:[identifier,{type:'null'}]};
const permission={type:'object',additionalProperties:false,properties:{tools:{type:'array',uniqueItems:true,items:{type:'string',minLength:1}},externalWrite:{enum:['ask','never']}}};
const condition={type:'object',required:['kind'],properties:{kind:{type:'string',minLength:1}}};
const failure={type:'object',additionalProperties:false,properties:{retry:{type:'integer',minimum:0,maximum:3},then:{enum:['human']}}};
const common={id:identifier,kind:{type:'string'},name:{type:'string'},description:{type:'string'},action_summary:{type:'string',minLength:1,maxLength:500},next:successor,lane:identifier,roles:{type:'array',uniqueItems:true,items:identifier},when:{type:'string'},verify:condition,on_failure:failure,permissions:permission,timeout:{type:'number',exclusiveMinimum:0},wiki:{type:'array',items:{type:'object',required:['page','hash'],properties:{page:{type:'string'},hash:{type:'string'}}}},externalWrite:{type:'boolean'}};
const step=(kind,properties,required=[])=>({type:'object',additionalProperties:false,required:['id','kind',...required],properties:{...common,kind:{const:kind},...properties}});
export const WORKFLOW_SCHEMA={type:'object',additionalProperties:false,required:['name','version','steps','permissions'],properties:{
  name:{type:'string',minLength:1,maxLength:200},version:{type:'integer',minimum:1},description:{type:'string'},
  trigger:{type:'object',required:['kind'],properties:{kind:{enum:['manual','routine']},schedule:{type:'string'}}},
  inputs:{type:'object',additionalProperties:{type:'object',properties:{type:{enum:['string','number','integer','boolean','object','array']},required:{type:'boolean'},description:{type:'string'},default:{},enum:{type:'array'}}}},
  lanes:{type:'array',maxItems:1000,items:{type:'object',additionalProperties:false,required:['id','name'],properties:{id:identifier,name:{type:'string',minLength:1,maxLength:200}}}},
  notes:{type:'array',maxItems:1000,items:{type:'object',additionalProperties:false,required:['nodeId','content'],properties:{nodeId:identifier,content:{type:'string',maxLength:4000}}}},
  metrics:{type:'object',additionalProperties:false,required:['expectedMinutes','partial'],properties:{expectedMinutes:{type:['number','null'],minimum:0},partial:{type:'boolean'}}},
  blueprint:{type:'object',additionalProperties:false,required:['id','version','workflowId'],properties:{id:{type:'string',maxLength:200},version:{type:'string',maxLength:200},workflowId:{type:'string',maxLength:200},roles:{type:'array',items:{type:'object',additionalProperties:false,required:['id','name'],properties:{id:identifier,name:{type:'string',minLength:1,maxLength:200}}}},formBindings:{type:'array',items:{type:'object',additionalProperties:false,required:['nodeId','id','name','formType'],properties:{nodeId:identifier,id:{type:'string',maxLength:200},name:{type:'string',maxLength:200},formType:{enum:['start','input','approval','review','report']},schemaRef:{type:'string',maxLength:500}}}}}},
  permissions:permission,on_failure:failure,steps:{type:'array',minItems:1,maxItems:1000,items:{oneOf:[
    step('tool',{adapter:{type:'string',pattern:'^(?:[a-z]+\\.[a-z_]+|mcp\\.[a-z][a-z0-9-]{1,39}\\.[A-Za-z_][A-Za-z0-9_.-]{0,149})$'},args:{type:'object'},idempotency:{type:'string'},outputs:{type:'object',required:['schema'],additionalProperties:false,properties:{schema:{type:'object'}}}},['adapter','args']),
    step('agent',{goal:{type:'string',minLength:1},tools:{type:'array',uniqueItems:true,items:{type:'string',minLength:1}},done_when:condition,outputs:{type:'object',required:['schema'],additionalProperties:false,properties:{schema:{type:'object'}}},budget:{type:'object',additionalProperties:false,properties:{calls:{type:'integer',minimum:1},minutes:{type:'number',exclusiveMinimum:0}}}},['goal','tools','done_when']),
    step('human',{ask:{type:'string',minLength:1},outputs:{type:'object',additionalProperties:false,properties:{decision:{type:'array',minItems:1,uniqueItems:true,items:{type:'string',minLength:1,pattern:'\\S'}}}}},['ask']),
    step('branch',{then:successor,else:successor},['when','then']),
    step('loop',{body:{type:'array',minItems:1,items:identifier},max:{type:'integer',minimum:1}},['when','body','max']),
    step('parallel',{branches:{type:'array',minItems:1,items:identifier}},['branches']),
    step('subflow',{workflow:{type:'string',minLength:1},inputs:{type:'object'}},['workflow'])
  ]}}
}};
const ajv=new Ajv({allErrors:false,strict:false,ownProperties:true,validateFormats:false});
const schema=ajv.compile(WORKFLOW_SCHEMA);
const defaultAdapters={web:['read','verify'],terminal:['run'],documents:['exists','read','hash'],mcp:['call']};
const error=(code,path,message)=>({ok:false,errors:[{code,path,message}]});
const pointer=(path,key)=>path+'/'+String(key).replace(/~/g,'~0').replace(/\//g,'~1');

function secretPath(value,path='',seen=new Set()){
  if(typeof value==='string')return !/^secret:[A-Za-z0-9가-힣_-]{1,80}$/.test(value)&&secretLike(value)?path:null;
  if(!value||typeof value!=='object')return null;
  if(seen.has(value))return path;seen.add(value);
  for(const [key,child] of Object.entries(value)){const found=secretPath(child,pointer(path,key),seen);if(found!==null)return found;}
  seen.delete(value);return null;
}

export function validateWorkflow(document,{adapters=defaultAdapters}={}){
  // Return fixed diagnostics: never include source snippets or credential values.
  if(!schema(document))return error('workflow_schema',schema.errors?.[0]?.instancePath||'','워크플로우 형식을 확인해 주세요.');
  const plain=secretPath(document);if(plain!==null)return error('workflow_secret_plain',plain,'비밀 값 대신 금고 참조를 사용해 주세요.');
  const ids=new Set();for(const [i,s] of document.steps.entries()){
    if(ids.has(s.id))return error('workflow_schema',`/steps/${i}/id`,'단계 식별자가 중복됩니다.');ids.add(s.id);
  }
  const laneIds=new Set();for(const lane of document.lanes||[]){if(laneIds.has(lane.id))return error('workflow_schema','/lanes','레인 식별자가 중복됩니다.');laneIds.add(lane.id);}
  const roleIds=new Set((document.blueprint?.roles||[]).map(r=>r.id));
  const edges=new Map();
  for(const [i,s] of document.steps.entries()){
    if(s.kind==='agent'){let resolved;try{resolved=expandStepTools(s.tools).tools;}catch{return error('workflow_tool_unknown',`/steps/${i}/tools`,'지원하는 에이전트 도구를 선택해 주세요.');}try{assertObservableCompletion({...s,resolvedTools:resolved});}catch(e){return error(e.message,`/steps/${i}/done_when`,'단계 결과를 관찰할 수 있는 완료 조건을 확인해 주세요.');}}
    if(s.roles?.some(id=>!roleIds.has(id)))return error('workflow_schema',`/steps/${i}/roles`,'단계의 역할을 찾을 수 없습니다.');
    if(s.lane&&!laneIds.has(s.lane))return error('workflow_schema',`/steps/${i}/lane`,'단계의 레인을 찾을 수 없습니다.');
    const successor=nextWorkflowStep(document,s);
    const refs=(s.kind==='branch'?[s.then,branchWorkflowStep(document,s,false)]:[successor,...(s.body||[]),...(s.branches||[])]).filter(Boolean);
    if(refs.some(id=>!ids.has(id)))return error('workflow_schema',`/steps/${i}`,'연결할 단계를 찾을 수 없습니다.');edges.set(s.id,refs);
    if(s.kind==='tool'){
      const parsed=parseWorkflowAdapter(s.adapter),adapter=parsed?.family,action=parsed?.action;const actions=Object.hasOwn(adapters,adapter)?adapters[adapter]:null;
      if(!Array.isArray(actions)||!actions.includes(action))return error('workflow_adapter_unknown',`/steps/${i}/adapter`,'지원하는 도구 동작을 선택해 주세요.');
      if(!document.permissions.tools?.some(tool=>tool===adapter||tool===s.adapter))return error('workflow_permission_widened',`/steps/${i}/adapter`,'워크플로우에 허용된 도구만 사용할 수 있습니다.');
    }
    const parent=document.permissions,child=s.permissions;
    if(parent.externalWrite==='never'&&child?.externalWrite==='ask')return error('workflow_permission_widened',`/steps/${i}/permissions`,'단계 권한은 워크플로우 권한보다 좁아야 합니다.');
    if(s.kind==='tool'&&child?.tools&&!child.tools.some(tool=>tool===s.adapter||tool===s.adapter.split('.')[0]))return error('workflow_permission_widened',`/steps/${i}/adapter`,'단계에 허용된 도구만 사용할 수 있습니다.');
    if(s.externalWrite&&(parent.externalWrite==='never'||child?.externalWrite==='never'))return error('workflow_external_write_forbidden',`/steps/${i}/externalWrite`,'외부 반영을 금지한 워크플로우입니다.');
    try{assertStepPermissions(document,s.kind==='agent'?{...s,resolvedTools:expandStepTools(s.tools).tools}:s);}catch(e){return error(e.message,`/steps/${i}/permissions`,'단계에 허용된 도구만 사용할 수 있습니다.');}
    if(s.outputs?.schema){try{new Ajv({strict:false,validateFormats:false}).compile(s.outputs.schema);}catch{return error('workflow_schema',`/steps/${i}/outputs/schema`,'단계 출력의 JSON Schema를 확인해 주세요.');}}
  }
  const active=new Set(),done=new Set();
  function cyclic(id){if(active.has(id))return true;if(done.has(id))return false;active.add(id);if(edges.get(id).some(cyclic))return true;active.delete(id);done.add(id);return false;}
  if(document.steps.some(s=>cyclic(s.id)))return error('workflow_cycle','/steps','순환 연결을 제거해 주세요.');
  return {ok:true,workflow:{...document,steps:document.steps.map(s=>s.kind==='agent'?{...s,resolvedTools:expandStepTools(s.tools).tools}:s)}};
}
