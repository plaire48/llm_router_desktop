export function afterEditCheckMessage(code,path){
 if(code==='source_stale')return `반영 뒤 ${path||'파일'} 내용이 바뀌었어요. 변경 내용을 확인한 뒤 다시 준비하거나 설정에서 편집 뒤 검사를 꺼 주세요.`;
 if(['shell_not_selected','shell_unavailable'].includes(code))return '기본 터미널을 설정에서 골라 주세요.';
 if(code==='question_pending')return '대기 중인 질문에 답한 뒤 준비해요.';
 if(code==='setup_cancelled')return '검사 준비를 취소했어요.';
 return `파일 반영은 끝났지만 검사 준비에 실패했어요 (${code}). 다시 준비하거나 설정에서 편집 뒤 검사를 꺼 주세요.`;
}
