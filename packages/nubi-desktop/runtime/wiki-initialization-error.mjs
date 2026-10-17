const safeCodes=new Set(['wiki_runtime_missing','wiki_skills_missing','wiki_snapshot_missing','git_access_denied','git_timeout','git_history_failed','git_unsafe_directory','wiki_interrupted','source_stale','provider_changed','wiki_git_required','wiki_source_limit','wiki_no_sources','wiki_empty','unauthorized','expired_token','response_invalid','model_unavailable','model_missing','context_length_exceeded','rate_limited','network_error','timeout','path_scope','project_changed','write_unconfirmed','tls_untrusted','tls_expired','tls_hostname','network_dns','network_refused','forbidden','no_credential','output_limit','response_json_invalid','model_failed']);
import {safeError} from '../../nubi-office/worker/connection-errors.mjs';
for(const code of ['claude_login_required','claude_cli_missing','claude_cli_unavailable','claude_cli_update','claude_cli_failed','claude_cli_timeout','claude_response_invalid','invalid_model'])safeCodes.add(code);
// The transport names a lost connection 'network' and a late answer 'model_timeout' (recovery.mjs); the view names the codes above (2026-10-12).
const transport={network:'network_error',model_timeout:'timeout',network_timeout:'timeout',request_failed:'model_failed'};
for(const code of ['wiki_plan_missing','wiki_plan_invalid','wiki_analysis_limit'])safeCodes.add(code);
function knownError(error,stage){
  if(/^wiki_review_/.test(error?.message||''))return ['wiki_review_source_limit','wiki_review_input_limit'].includes(error.message)?'wiki_review_scope':'wiki_review_incomplete';
  if(error?.message==='Repository planning worker exited without submit_plan.')return 'wiki_plan_missing';
  if(error?.name==='GraphRecursionError')return 'wiki_analysis_limit';
  if(['planning','replanning'].includes(stage)&&error?.code==='invalid_input')return 'wiki_plan_invalid';
  const code=transport[error?.message]||error?.message;
  if(safeCodes.has(code))return code;
  if(['EACCES','EPERM'].includes(error?.code))return 'wiki_permission_denied';
  if(error?.code==='ENOSPC')return 'wiki_disk_full';
  if(error?.code==='EEXIST')return 'wiki_output_conflict';
  if(stage==='snapshot_git'&&error?.code==='ENOENT')return 'wiki_git_required';
  if(stage==='snapshot_git'&&(error?.killed||error?.code==='ETIMEDOUT'))return 'wiki_git_timeout';
  if(error?.code==='ENOENT')return stage==='snapshot'?'wiki_snapshot_missing':stage==='preparing_runtime'?'wiki_runtime_missing':stage==='preparing_skills'?'wiki_skills_missing':'wiki_source_missing';
  if(error?.killed||error?.name==='TimeoutError')return 'timeout';
  const normalized=safeError(error);
  if(normalized==='request_failed')return null;
  const mapped=transport[normalized]||normalized;
  return safeCodes.has(mapped)?mapped:null;
}
export function wikiInitializationError(error,stage){
  // Framework wrappers retain a cause; only fixed codes cross the UI boundary.
  // Never turn a raw message, stack, URL or model reply into a public diagnostic.
  const seen=new Set();
  for(let current=error,depth=0;current&&depth<5&&!seen.has(current);current=current.cause,depth++){
    seen.add(current);const code=knownError(current,stage);if(code)return code;
  }
  return stage==='snapshot_git'?'wiki_snapshot_failed':'wiki_failed';
}
