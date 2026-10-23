import {officeReadDiagnostic} from '../runtime/office-read-diagnostic.mjs';
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
 mail_source_missing:{title:'Knox 원문 파일을 찾을 수 없어요',action:'settings'},
 mail_source_unavailable:{title:'Knox 원문의 읽기 권한을 확인해 주세요',action:'settings'},
 mail_attachment_analysis_failed:{title:'첨부를 읽지 못해 수집하지 않았어요',action:'settings'},
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
 document_office_policy:{title:'Office에서 읽기 전용으로 열지 못했어요',action:'retry'},
 document_office_timeout:{title:'Office 첨부 읽기 시간이 초과됐어요',action:'retry'},
 document_office_cleanup:{title:'Office 읽기용 사본을 확인해 주세요',action:'source'},
 document_office_busy:{title:'Office가 자동 읽기 요청을 받지 못했어요',action:'retry'},
 document_office_read_failed:{title:'Office에서 첨부를 읽지 못했어요',action:'retry'},
};
export function mailAttentionInfo(code){
 if(code==='mail_cancelled')return {title:'작업이 중단됐어요',action:null,cancelled:true};
 return issues[code]|| (mailConnectionErrors[code]?{...mailConnectionErrors[code],action:'settings'}:{title:'메일 처리를 완료하지 못했어요',action:'retry'});
}

const officeStages={prepare:'읽기 사본 준비',activate:'Office 실행',configure:'읽기 설정',open:'파일 열기',read:'본문 읽기',verify:'읽기 결과 확인',close:'문서 닫기',restore:'Office 설정 복구',release:'읽기 연결 정리'};
export function officeReadStatus(value){
 const diagnostic=officeReadDiagnostic(value);if(!diagnostic?.stage)return null;
 const name={word:'Word',excel:'Excel',powerpoint:'PowerPoint'}[diagnostic.app]||'Office';
 const sheet=diagnostic.sheetIndex?`현재 시트 ${diagnostic.sheetIndex}/${diagnostic.sheetCount}`:'';
 const unit={cells:'셀',slides:'장',characters:'자'}[diagnostic.unit];
 return {...diagnostic,label:[name,officeStages[diagnostic.stage],sheet].filter(Boolean).join(' / '),unitLabel:unit};
}
export function officeReadHelp(value){
 const diagnostic=officeReadDiagnostic(value);if(!diagnostic)return '';
 const facts=[{word:'Word',excel:'Excel',powerpoint:'PowerPoint'}[diagnostic.app],diagnostic.officeVersion,officeStages[diagnostic.stage],diagnostic.hresult].filter(Boolean).join(' / ');
 const status=officeReadStatus(diagnostic),amount=status?.unitLabel?`${status.sheetIndex?`현재 시트 ${status.sheetIndex}/${status.sheetCount}, `:''}${status.completed.toLocaleString('ko-KR')}/${status.total.toLocaleString('ko-KR')}${status.unitLabel} 읽음`:'';
 const elapsed=diagnostic.elapsedMs!==undefined?`${Math.round(diagnostic.elapsedMs/1000)}초 경과`:'';
 const timeout=diagnostic.timeoutKind==='idle'?'최근 읽기 진행을 확인하지 못해 중단했어요.':diagnostic.timeoutKind==='overall'?'전체 읽기 제한 시간에 도달했어요.':'';
 const action=['activate','configure','open','read'].includes(diagnostic.stage)?'Office에서 해당 첨부를 직접 열어 안내나 대기 창을 확인한 뒤 다시 읽어 주세요.':'';
 return [facts,[amount,elapsed].filter(Boolean).join(' / '),timeout,action,diagnostic.cleanupFailed?'읽기용 사본 정리도 확인이 필요해요.':''].filter(Boolean).join('\n');
}
export function mailAttentionRowInfo(row){
 const failures=row.attachmentFailures||[],attachmentsOnly=row.summary===false&&failures.length>0;
 const issue=mailAttentionInfo(row.error),filename=attachmentsOnly?failures[0].filename:'';
 const detail=[...(!attachmentsOnly?[issue.title]:[]),...failures.map(item=>[item.filename,mailAttentionInfo(item.error).title,officeReadHelp(item.officeDiagnostic)].filter(Boolean).join(' — '))].join('\n');
 return {...issue,action:failures.some(item=>item.error==='mail_source_changed')?'source':issue.action,attachmentsOnly,filename,
  title:attachmentsOnly?[filename,issue.title].filter(Boolean).join(' — '):issue.title+(failures.length?' / 첨부 확인 필요':''),detail:detail||issue.title};
}
