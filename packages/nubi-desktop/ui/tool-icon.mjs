// Host tool identity only. Arguments and model-written progress never choose
// an icon or expose command/credential contents in the compact status line.
const groups={
 terminal:['propose_setup_action','propose_command_repair','propose_process_input','read_process_output','inspect_environment','inspect_dev_server'],
 search:['source_search','wiki_query','knowledge_query','personal_mail_query','discover_capabilities','select_tools'],
 file:['read_source','read_attached_document','read_editor_range','inspect_path','code_outline','inspect_code','list_skill_resources','read_skill','use_skill'],
 pencil:['propose_patch','propose_edit','propose_new_file','propose_editor_edit','record_change_plan','update_wiki'],
 browser:['open_workspace_page','open_development_preview','inspect_workspace_page','learn_browser_screen','remember_browser_screen','compare_local_pages'],
 window:['observe_computer','inspect_workspace_window','inspect_app_window','request_computer_connection','propose_computer_action','propose_computer_batch','propose_computer_launch','list_computer_apps'],
 clipboardCheck:['review_task','inspect_workspace_changes','verify_computer_value','verify_computer_outcome','compare_document_values','finish_native_office'],
 book:['ask_openwiki','analyze_documents','read_document_analysis','delegate_analysis','collect_analysis','read_analysis_evidence'],
 mail:['read_personal_mail'],
 message:['ask_user','read_conversation','progress_note'],
 taskList:['update_plan'],
 presentation:['inspect_native_office','write_native_office','apply_native_office','native_office_status'],
 clockRewind:['recovery_snapshot','computer_checkpoint'],
 lightbulb:['compact_context']
};
const icons=new Map(Object.entries(groups).flatMap(([icon,tools])=>tools.map(tool=>[tool,icon])));
export const toolIcon=tool=>icons.get(tool)||(/^mcp__playwright__/.test(tool||'')?'browser':'apps');
