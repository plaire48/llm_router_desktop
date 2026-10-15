import {mailConnectionErrors} from './mail-connection-error.mjs';

const issues={
 mail_summary_failed:{title:'AI 응답을 받지 못했어요',action:'retry'},
 mail_summary_interrupted:{title:'메일 정리가 중단됐어요',action:'retry'},
 mail_model_missing:{title:'정리할 모델을 연결해 주세요',action:'settings'},
 mail_model_changed:{title:'정리 모델의 연결을 확인해 주세요',action:'settings'},
 mail_storage_failed:{title:'위키를 저장하지 못했어요',action:'retry'},
 mail_storage_permission:{title:'메일 저장 위치의 권한을 확인해 주세요',action:'settings'},
 mail_file_conflict:{title:'저장된 위키가 변경됐어요',action:'retry'},
 mail_source_changed:{title:'보관한 원문이 변경됐어요',action:'source'},
 mail_parse_failed:{title:'메일 본문을 읽지 못했어요',action:'settings'},
 mail_size_limit:{title:'이 메일은 원문 보관 범위(96MB)를 넘었어요',action:null},
 mail_summary_invalid:{title:'AI 정리 결과를 확인하지 못했어요',action:'retry'},
 document_format:{title:'지원하지 않는 첨부 형식이에요',action:'source'},
 document_empty:{title:'첨부에서 읽을 본문을 찾지 못했어요',action:'source'},
 document_limit:{title:'첨부를 나눠서 열어 주세요. 파일 크기나 문서 분량이 읽기 범위를 넘었어요',action:'source'},
 document_password:{title:'첨부에 암호가 설정되어 있어요',action:'source'},
 document_vision_unavailable:{title:'이미지를 읽을 AI 모델이 필요해요',action:'settings'},
 document_timeout:{title:'첨부 읽기 시간이 초과됐어요',action:'retry'},
 document_reader_busy:{title:'다른 첨부를 읽고 있어요',action:'retry'},
 document_read_failed:{title:'첨부 내용을 읽지 못했어요',action:'retry'},
 document_office_required:{title:'Office에서 첨부를 확인해 주세요',action:'source'},
 document_office_missing:{title:'Office 설치를 확인해 주세요',action:'source'},
 document_office_version:{title:'Office 호환 버전을 확인해 주세요',action:'source'},
 document_office_policy:{title:'회사 Office 실행 정책을 확인해 주세요',action:'source'},
 document_office_timeout:{title:'Office 첨부 읽기 시간이 초과됐어요',action:'retry'},
 document_office_cleanup:{title:'Office 읽기용 사본을 확인해 주세요',action:'source'},
 document_office_read_failed:{title:'Office에서 첨부를 읽지 못했어요',action:'retry'},
};
export function mailAttentionInfo(code){
 if(code==='mail_cancelled')return {title:'작업이 중단됐어요',action:null,cancelled:true};
 return issues[code]|| (mailConnectionErrors[code]?{...mailConnectionErrors[code],action:'settings'}:{title:'메일 처리를 완료하지 못했어요',action:'retry'});
}

export function mailAttentionRowInfo(row){
 const failures=row.attachmentFailures||[],attachmentsOnly=row.summary===false&&failures.length>0;
 const issue=mailAttentionInfo(row.error),filename=attachmentsOnly?failures[0].filename:'';
 const detail=[...(!attachmentsOnly?[issue.title]:[]),...failures.map(item=>[item.filename,mailAttentionInfo(item.error).title].filter(Boolean).join(' — '))].join('\n');
 return {...issue,action:failures.some(item=>item.error==='mail_source_changed')?'source':issue.action,attachmentsOnly,filename,
  title:attachmentsOnly?[filename,issue.title].filter(Boolean).join(' — '):issue.title+(failures.length?' / 첨부 확인 필요':''),detail:detail||issue.title};
}
