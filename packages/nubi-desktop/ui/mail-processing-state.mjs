import {mailAttentionInfo,officeReadStatus} from './mail-attention-state.mjs';

export const mailProcessingStages={indexing:'메일 검색 준비 중',indexed:'메일 검색 준비 완료',ready:'정리 완료',connecting:'메일 연결 중',disconnected:'메일 연결 필요',off:'자동 정리 꺼짐',checking:'새 메일 확인 중',attachments:'첨부 읽는 중',organizing:'메일 정리 중',waiting_model:'모델 연결 대기',waiting_agent:'현재 작업 후 정리',queued:'정리 대기',paused:'수집 일시중지',attention:'확인 필요',watching:'새 메일 확인 대기'};
const descriptions={
 indexing:'보관한 메일을 검색할 수 있도록 준비하고 있어요.',indexed:'메일 검색을 준비했어요. 필요한 메일을 찾아 위키로 정리할 수 있어요.',
 ready:'보관한 메일의 정리를 마쳤어요.',connecting:'메일 연결을 확인하고 있어요.',disconnected:'메일을 연결하면 수집과 정리를 이어갑니다.',
 off:'메일 자동 정리가 꺼져 있어요. 보관된 메일은 유지됩니다.',checking:'서버에서 새 메일을 확인하고 가져오고 있어요.',
 attachments:'메일의 첨부 내용을 읽고 있어요.',organizing:'보관한 메일을 AI로 정리하고 위키에 저장하고 있어요.',
 waiting_model:'정리할 AI 모델의 연결을 기다리고 있어요.',waiting_agent:'현재 에이전트 작업이 끝나면 메일 정리를 이어갑니다.',
 queued:'보관한 메일의 정리를 기다리고 있어요.',paused:'새 메일 수집을 쉬고 있어요. 보관한 메일의 정리 상태는 아래에서 확인할 수 있어요.',
 attention:'아래 원인과 확인할 메일을 확인해 주세요.',watching:'새 메일을 정해진 간격으로 확인합니다.'
};
const count=value=>Number.isSafeInteger(value)&&value>=0;
export function mailProcessingState(status){
 if(!status)return null;
 const progress=status.progress||{},totals=status.counts||{};
 const stage=status.connecting?'connecting':!status.connected&&!status.localCount?'disconnected':!status.autoWiki?'off':progress.stage||(status.error?'attention':status.checking?'checking':status.readingAttachments?'attachments':status.summarizing?'organizing':status.watchPaused?'paused':'watching');
 const paused=['off','disconnected','paused'].includes(stage);
 const counts=[['보관된 메일',totals.received],['정리 완료',progress.completed??totals.saved],[paused?'정리 보류':'정리 대기',progress.queued??totals.queued],['받을 메일',progress.pendingServer],['확인 필요',progress.attention??totals.attentionTotal]].filter(([,value])=>count(value)).map(([label,value])=>({label,value}));
 let measurement=null;
 const attachment=progress.attachment;
 const office=stage==='attachments'?officeReadStatus(attachment?.current?.office):null;
 if(stage==='attachments'&&count(attachment?.completed)&&count(attachment?.total)&&attachment.total>0&&attachment.completed<=attachment.total)measurement={label:'첨부 읽기',completed:attachment.completed,total:attachment.total};
 if(office)measurement=null;
 if(office?.stage==='read'&&office.unitLabel)measurement={label:office.sheetIndex?`현재 시트 ${office.sheetIndex}/${office.sheetCount} 읽기`:'Office 본문 읽기',completed:office.completed,total:office.total,unit:office.unitLabel,identity:`${attachment.current.id}:${office.unit}:${office.sheetIndex||0}`};
 if(['indexing','indexed'].includes(stage)&&count(progress.indexed)&&count(progress.remaining)&&progress.indexed+progress.remaining>0)measurement={label:'검색 준비',completed:progress.indexed,total:progress.indexed+progress.remaining};
 const method=status.protocol==='desktop'||status.connectionMethod==='desktop'?'Knox Desktop':status.protocol==='portal'||status.connectionMethod==='portal'?'포털':'POP3';
 return {stage,title:mailProcessingStages[stage]||'메일 처리 중',detail:office?[attachment.current.filename,office.label].filter(Boolean).join(' / '):descriptions[stage]||'현재 메일 처리 정보를 확인하고 있어요.',counts,measurement,...(office?{office}:{}),connection:status.connecting?`${method} 연결 중`:status.connected?`${method} 연결됨`:'서버 연결 없음'};
}

export function mailStatusReadIssue(error){
 const code=error?.message;
 if(code==='mail_reset_pending')return {title:'메일 데이터 초기화가 진행 중이에요',detail:'초기화가 끝나면 상태를 다시 불러옵니다.'};
 if(['backend_unavailable','service_unavailable','host_unavailable','mail_cancelled'].includes(code))return {title:'메일 서비스에 연결하지 못했어요',detail:'작업 상태를 새로고침해 주세요.'};
 const info=mailAttentionInfo(code);
 return {title:info.title==='메일 처리를 완료하지 못했어요'?'상태 조회 응답을 받지 못했어요':info.title,detail:info.detail||'새로고침으로 현재 상태를 다시 불러올 수 있어요.'};
}
