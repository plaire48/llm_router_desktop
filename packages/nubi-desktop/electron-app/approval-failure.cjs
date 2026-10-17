// Only fixed diagnostic fields may cross IPC. Never forward server text, URLs or account values.
const codes=new Set(['mail_portal_login','mail_portal_approval_login','mail_portal_identity','mail_portal_timeout','mail_portal_format','mail_cancelled','mail_portal_approval_request','mail_portal_approval_forbidden','mail_portal_rate_limited','mail_portal_unavailable','mail_portal_request','mail_portal_response','mail_portal_not_found','mail_portal_redirect','mail_tls_error','mail_size_limit','mail_input_invalid','mail_approval_empty','mail_approval_parse']);
function safeApprovalFailure(value){
 if(!value||!['identity','list','document','parse'].includes(value.stage)||!codes.has(value.code))return null;
 return {stage:value.stage,code:value.code,...(Number.isInteger(value.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599?{httpStatus:value.httpStatus}:{})};
}
function approvalFailure(error,stage){
 const code=codes.has(error?.message)?error.message:stage==='parse'?'mail_approval_parse':'mail_portal_request';
 const failure=safeApprovalFailure(error?.approvalFailure)||safeApprovalFailure({stage,code,httpStatus:error?.httpStatus});
 return Object.assign(Error(failure.code),{approvalFailure:failure});
}
async function approvalStep(stage,run){try{return await run();}catch(error){throw approvalFailure(error,stage);}}
module.exports={safeApprovalFailure,approvalFailure,approvalStep};
