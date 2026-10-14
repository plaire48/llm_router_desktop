// The persisted IDs stay stable; inquiry Issues retain the category name at submission.
export function inquiryTypeOptions(document) {
  if(!document||!Array.isArray(document.items))throw Error('문의 유형을 불러오지 못했습니다. 다시 시도하세요.');
  const names=new Set(),ids=new Set();
  for(const row of document.items){
    if(!row||typeof row.id!=='string'||!row.id||typeof row.label!=='string'||!row.label.trim()||/[\r\n]/.test(row.label)||ids.has(row.id)||names.has(row.label.trim().toLowerCase()))throw Error('문의 유형에 비어 있거나 중복된 이름이 있습니다. 기준 설정을 확인하세요.');
    ids.add(row.id);names.add(row.label.trim().toLowerCase());
  }
  return document.items.filter(row=>row.active!==false).sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)).map(row=>({id:row.id,label:row.label.trim()}));
}
