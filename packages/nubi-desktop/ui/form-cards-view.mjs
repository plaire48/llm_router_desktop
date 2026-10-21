// Presentation only. The host independently validates paths and every state transition.
export function formOutputPath(name,date=new Date()){
 const day=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
 return `문서/${String(name||'양식').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'-')}-${day}.docx`;
}
export function validFormOutput(output,source=''){
 const p=String(output).replaceAll('\\','/'),s=String(source).replaceAll('\\','/');
 return Boolean(p&&/\.docx$/i.test(p)&&!/^([a-z]:|\/|~)/i.test(p)&&!p.split('/').some(x=>x==='..'||x==='.'||!x)&&!/[\u0000-\u001f:*?"<>|]/.test(p)&&p.toLowerCase()!==s.toLowerCase());
}
export function formState(plan){return ['running','asking','approval','ready','written','failed','cancelled'].includes(plan?.state)?plan.state:'unknown';}
export function formSourceText(source){if(!source)return '출처 미확인';if(typeof source==='string')return source;const kind={wiki:'위키',mail:'메일',file:'파일',note:'메모',request:'작성 요청',answer:'사용자 답변',history:'자료'}[source.kind]||'자료';return `${kind}${source.ref?` ${source.ref}`:''}${source.quote?` — ${source.quote}`:''}`;}
export function formError(error){return ({form_not_fillable:'이 양식은 Word에서 읽기 전용으로 보호되어 채울 수 없어요. Word의 편집 제한을 푼 뒤 다시 등록해 주세요.',form_office_required:'이 문서를 Office에서 열고 누비에 연결한 뒤 등록해 주세요.',form_office_app_mismatch:'같은 종류의 Office 문서를 연결해 주세요.',form_fill_unsupported_app:'저장된 양식입니다. 채우기는 준비 중이에요.',form_missing:'등록된 양식을 찾지 못했어요.',form_name_invalid:'양식 이름을 확인해 주세요.',form_source_missing:'원본 파일을 찾지 못했어요.',form_request_required:'작성할 내용을 입력해 주세요.',provider_missing:'모델을 연결한 뒤 다시 시작해 주세요.',form_plan_missing:'작성 상태를 찾지 못했어요. 다시 시작해 주세요.',form_plan_not_asking:'현재는 답변을 받을 수 없어요. 상태를 다시 확인해 주세요.',form_plan_not_ready:'채움표를 준비한 뒤 저장할 수 있어요.',form_plan_not_written:'사본을 저장한 뒤 전후를 비교할 수 있어요.',form_output_invalid:'Workspace 안의 .docx 사본 경로를 입력해 주세요.',form_output_exists:'같은 이름의 파일이 있어요. 다른 사본 이름을 입력해 주세요.',form_source_protected:'원본은 덮어쓸 수 없어요. 다른 사본 경로를 입력해 주세요.',project_changed:'프로젝트가 바뀌었어요. 현재 프로젝트에서 다시 열어 주세요.',document_form_action_invalid:'현재 사용할 수 없는 문서 동작이에요.'})[error?.message||error]||'응답을 확인하지 못했어요. 현재 상태를 확인한 뒤 계속해 주세요.';}

export function formFidelity(form){return form?.fidelity==='office'?'Office로 확인함':form?.fidelity==='file'?'파일만 읽음':'읽기 출처 미확인';}
