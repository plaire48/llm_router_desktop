// Closed, host-owned vocabulary. Being known never grants availability or approval.
const known=new Set(`read_attached_document inspect_workspace_window inspect_workspace_page open_workspace_page personal_mail_query read_personal_mail mail_facts inspect_environment read_document_analysis spawn_task dismiss_task send_file mark_chapter discover_capabilities use_skill list_skill_resources read_skill read_conversation computer_checkpoint read_computer_result request_computer_connection list_computer_apps propose_computer_launch verify_computer_value ground_computer_target observe_computer propose_computer_action propose_computer_batch verify_computer_outcome compare_local_pages read_process_output inspect_dev_server open_development_preview propose_process_input recovery_snapshot propose_command_repair source_search inspect_workspace_changes code_outline inspect_code inspect_path propose_new_file read_source update_wiki knowledge_query wiki_query ask_openwiki propose_patch propose_edit ask_user remember_browser_screen learn_browser_screen update_plan record_change_plan propose_setup_action delegate_research continue_research analyze_documents submit_step_output compare_document_values native_office_status inspect_native_office write_native_office finish_native_office`.split(' '));
export const TOOL_PREREQUISITES=Object.freeze(Object.fromEntries(Object.entries({
  propose_new_file:['inspect_path','record_change_plan'],propose_patch:['read_source','record_change_plan'],propose_edit:['read_source','record_change_plan'],
  propose_setup_action:['inspect_environment','read_process_output'],personal_mail_query:['read_personal_mail'],
  use_skill:['discover_capabilities','read_skill'],delegate_research:['continue_research']
}).map(([name,tools])=>[name,Object.freeze(tools)])));
export function expandStepTools(declared){
  if(!Array.isArray(declared)||declared.some(name=>!known.has(name)))throw Error('workflow_tool_unknown');
  const tools=[...new Set(declared)],added=[];
  const add=(tool,because)=>{if(!tools.includes(tool)){tools.push(tool);added.push({tool,because});}};
  for(const name of tools.slice())for(const tool of TOOL_PREREQUISITES[name]||[])add(tool,name);
  add('update_plan','workflow_step');add('submit_step_output','workflow_step');
  return {tools,added};
}
