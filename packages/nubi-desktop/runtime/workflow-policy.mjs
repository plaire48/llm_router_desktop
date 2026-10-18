import {irreversibleCommand,irreversibleMcpTool} from './irreversible-actions.mjs';

// Closed capability mapping owned by the host, never inferred from a model label.
const families={
 documents:'read_attached_document compare_document_values read_source source_search code_outline inspect_code inspect_path inspect_workspace_changes propose_new_file propose_patch propose_edit',
 terminal:'inspect_environment read_process_output inspect_dev_server open_development_preview propose_process_input recovery_snapshot propose_command_repair propose_setup_action',
 wiki:'update_wiki knowledge_query wiki_query ask_openwiki',
 mail:'personal_mail_query read_personal_mail mail_facts',
 web:'inspect_workspace_window inspect_workspace_page open_workspace_page remember_browser_screen learn_browser_screen',
 computer:'computer_checkpoint read_computer_result request_computer_connection list_computer_apps propose_computer_launch verify_computer_value ground_computer_target observe_computer propose_computer_action propose_computer_batch verify_computer_outcome compare_local_pages',
 office:'native_office_status inspect_native_office write_native_office finish_native_office',
 skills:'use_skill list_skill_resources read_skill',
 research:'delegate_research continue_research analyze_documents read_document_analysis',
 tasks:'spawn_task dismiss_task read_conversation',artifacts:'send_file'
};
const category=new Map(Object.entries(families).flatMap(([family,names])=>names.split(' ').map(name=>[name,family])));
const common=new Set(['update_plan','submit_step_output','record_change_plan','discover_capabilities','ask_user','mark_chapter']);
export function toolGranted(grants,name){return common.has(name)||Array.isArray(grants)&&grants.some(grant=>grant===name||grant===category.get(name)||name.startsWith(grant+'.'));}
export function stepPermissions(workflow,step){return {tools:step.permissions?.tools??workflow.permissions?.tools??[],externalWrite:step.permissions?.externalWrite??workflow.permissions?.externalWrite??'ask'};}
export function assertStepPermissions(workflow,step){
 const parent=workflow.permissions||{},effective=stepPermissions(workflow,step);
 if(parent.externalWrite==='never'&&effective.externalWrite!=='never')throw Error('workflow_permission_widened');
 if(step.permissions?.tools?.some(name=>!toolGranted(parent.tools,name)))throw Error('workflow_permission_widened');
 for(const name of step.kind==='agent'?step.resolvedTools||[]:step.kind==='tool'?[step.adapter]:[])if(!toolGranted(parent.tools,name)||!toolGranted(effective.tools,name))throw Error('workflow_permission_widened');
 if(step.externalWrite&&effective.externalWrite==='never')throw Error('workflow_external_write_forbidden');
 return effective;
}
export function assertWorkflowCall(workflow,step,name,args={},mcp){
 const permission=assertStepPermissions(workflow,step);
 if(!toolGranted(permission.tools,name))throw Error('workflow_tool_forbidden');
 if(permission.externalWrite!=='never'||name==='send_file')return;
 const command=['terminal.run','propose_setup_action','propose_command_repair','propose_process_input'].includes(name)?args.script??args.text??args.input:'';
 // Desktop screen actions cannot prove that a click is local rather than Publish/Send.
 const external=['propose_computer_action','propose_computer_batch'].includes(name)||
  irreversibleCommand(command).matched||mcp&&irreversibleMcpTool(mcp.tool,{serverId:mcp.serverId}).matched||
  name.startsWith('mcp__')&&irreversibleMcpTool({name}).matched;
 if(external)throw Error('workflow_external_write_forbidden');
}
