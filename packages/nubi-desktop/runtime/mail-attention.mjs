// One mail is one attention item, even when both summary and attachment reading failed.
export function mailAttention(rows,{account,attachmentReading=true,rejected=[]}={}){
 const items=rows.filter(row=>!account||row.account===account||row.protocol==='local').flatMap(row=>{
  const summary=row.state==='attention'&&row.error!=='mail_cancelled';
  const failures=attachmentReading&&row.attachmentState==='attention'?(row.attachmentFailures||[]).filter(item=>item.error!=='mail_cancelled'):[];
  const attachments=attachmentReading&&row.attachmentState==='attention'&&(!row.attachmentFailures?.length||failures.length>0);
  if(!summary&&!attachments)return [];
  const attachmentFailures=attachments?(failures.length?failures:[{error:'document_read_failed'}]).map(({filename,error})=>({filename:typeof filename==='string'?filename:'',error:/^(document_[a-z_]+|mail_source_changed)$/.test(error)?error:'document_read_failed'})):[];
  return [{id:row.id,subject:row.subject,from:row.from,sourceHash:row.sourceHash,error:summary?row.error:attachmentFailures[0].error,summary:!!summary,attachmentFailures}];
 });
 return {items,rejected:rejected.filter(item=>item.error!=='mail_cancelled')};
}
