// Adapt the supplied page/count web API to the existing importer cursor. No
// token handling, process spawning or second mail store is introduced.
class PortalWebList {
 constructor(){this.mode=null;this.page=null;this.metadata=new Map();}
 async read(input,request,valid=()=>{}){
  if(this.mode==='desktop')return request('list',input);
  const folderId=String(input.folderId),cursor=String(input.cursor??0),setCd=input.setCd||'';
  if(!/^\d{1,15}$/.test(folderId)||!/^\d{1,20}$/.test(cursor))throw Error('mail_input_invalid');
  const page=cursor==='0'?1:this.page?.folderId===folderId&&this.page.setCd===setCd&&this.page.cursors.has(cursor)?this.page.next:null;
  if(!page||page>200)throw Error('mail_input_invalid');
  let result;
  try{result=await request('webList',{folderId,page,count:30});valid();}
  catch(error){valid();if(this.mode===null&&error.message==='mail_portal_endpoint_unavailable'){this.mode='desktop';return request('list',input);}throw error;}
  if(!Array.isArray(result?.headerVOs)||result.headerVOs.length>100||!result.headerVOs.every(row=>row&&/^\d{1,20}$/.test(String(row.mailSeq))))throw Error('mail_portal_format');
  if(result.totalCount!==undefined&&(!/^\d+$/.test(String(result.totalCount))||!Number.isSafeInteger(Number(result.totalCount))))throw Error('mail_portal_format');
  this.mode='web';this.page={folderId,setCd,cursors:new Set(result.headerVOs.map(row=>String(row.mailSeq))),next:page+1};
  // Keep only the current page. Its rows are consumed before the importer
  // requests another page, so a large mailbox cannot grow an unbounded cache.
  this.metadata=new Map(result.headerVOs.map(row=>[folderId+':'+row.mailSeq,row]));
  return {...result,liteHeaderVOs:result.headerVOs};
 }
 summary(input){return this.mode==='web'?this.metadata.get(String(input.folderId)+':'+input.seq):undefined;}
}
module.exports={PortalWebList};
