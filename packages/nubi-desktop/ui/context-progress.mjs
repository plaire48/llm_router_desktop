// Host stages only. No invented percentage or elapsed-time completion.
export function contextProgressLabel(context) {
  if(context?.phase!=='summarizing')return null;
  const operation=context.operation==='context'?'컨텍스트 압축':'대화 내용 정리';
  return context.stage==='review'?`${operation} 검토 중`:`${operation} 중`;
}
