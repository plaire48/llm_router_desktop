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
 mail_size_limit:{title:'11 MB를 넘는 메일은 가져올 수 없어요',action:null},
 mail_summary_invalid:{title:'AI 정리 결과를 확인하지 못했어요',action:'retry'},
};
export function mailAttentionInfo(code){
 if(code==='mail_cancelled')return {title:'작업이 중단됐어요',action:null,cancelled:true};
 return issues[code]|| (mailConnectionErrors[code]?{...mailConnectionErrors[code],action:'settings'}:{title:'메일 처리를 완료하지 못했어요',action:'retry'});
}
