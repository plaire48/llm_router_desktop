// Browser-safe, closed completion vocabulary. Unknown tools are never read-only.
const readTools=new Set(`use_skill delegate_research continue_research analyze_documents read_attached_document inspect_workspace_window inspect_workspace_page personal_mail_query read_personal_mail mail_facts inspect_environment read_document_analysis read_conversation computer_checkpoint read_computer_result list_computer_apps verify_computer_value ground_computer_target observe_computer verify_computer_outcome compare_local_pages read_process_output inspect_dev_server recovery_snapshot source_search inspect_workspace_changes code_outline inspect_code inspect_path read_source knowledge_query wiki_query ask_openwiki discover_capabilities list_skill_resources read_skill native_office_status inspect_native_office compare_document_values update_plan submit_step_output`.split(' '));
const grounded=new Set(['wiki_query','ask_openwiki','read_personal_mail','read_source','source_search']);
export function completionChecks(check,depth=0){
 if(!check||typeof check!=='object'||Array.isArray(check)||typeof check.kind!=='string'||depth>8)throw Error('workflow_schema');
 if(check.kind==='all_of'){
  if(!Array.isArray(check.all_of)||!check.all_of.length||check.all_of.length>16)throw Error('workflow_schema');
  return check.all_of.flatMap(child=>completionChecks(child,depth+1));
 }
 if(check.kind==='output_schema'&&check.evidence!==undefined){const e=check.evidence;if(!e||typeof e!=='object'||Array.isArray(e)||e.min!==undefined&&(!Number.isSafeInteger(e.min)||e.min<0||e.min>1000)||e.field!==undefined&&(typeof e.field!=='string'||!e.field||['__proto__','constructor','prototype'].includes(e.field)))throw Error('workflow_schema');}
 return [check];
}
export function assertObservableCompletion(step){
 const checks=completionChecks(step.done_when);
 if(!checks.some(check=>check.kind==='output_schema'))return;
 if((step.externalWrite||(step.resolvedTools||[]).some(tool=>!readTools.has(tool)))&&!checks.some(check=>['file_exists','file_hash'].includes(check.kind)&&typeof check.path==='string'&&check.path.trim()))throw Error('workflow_done_when_unobservable');
}
export function evidenceRequirements(step){return completionChecks(step.done_when).filter(check=>check.kind==='output_schema').map(check=>({field:check.evidence?.field||'evidence',min:check.evidence?.min??((step.resolvedTools||[]).some(name=>grounded.has(name))?1:0)}));}
export function completionLabel(check){if(!check)return '';if(check.kind==='output_schema')return '결과 제출 확인';if(check.kind==='all_of')return check.all_of.map(completionLabel).join(' + ');return {file_exists:'파일 존재 확인',file_hash:'파일 해시 확인'}[check.kind]||check.kind;}
