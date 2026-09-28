const methods=new Set(['document_skill_import','document_skill_save','document_skill_remove','template_register','template_catalog_index','template_catalog_use','template_catalog_rename','template_catalog_remove']);
export async function catalogMutation(method,payload,{call,operationId=crypto.randomUUID()}){
  if(!methods.has(method))throw new Error('unsafe_tool_retry');
  try{return await call(method,{...payload,operationId});}
  catch(error){
    if(!['office_timeout','office_failed','write_uncertain','template_save_uncertain'].includes(error.message))throw error;
    // One read-only reconciliation; never replay a copy, registration or rename.
    let receipt;try{receipt=await call('template_catalog_receipt',{operationId});}catch{throw new Error('write_uncertain');}
    if(receipt?.outcome!=='applied'||!receipt.result)throw new Error('write_uncertain');
    return receipt.result;
  }
}
export function catalogEntries(result,host){
  if(result?.host!==host||!Array.isArray(result.entries)||result.entries.length>200||!Number.isInteger(result.unreadable)||result.unreadable<0)throw new Error('template_record_invalid');
  const ids=new Set();
  return result.entries.map(entry=>{
    if(entry.host!==host||typeof entry.id!=='string'||!/^[a-f0-9-]{36}$/.test(entry.id)||ids.has(entry.id)||!Number.isInteger(entry.revision)||entry.revision<1||typeof entry.name!=='string'||!entry.name.trim()||entry.name.length>100||typeof entry.summary!=='string'||entry.summary.length>3000||!Number.isInteger(entry.inputCount)||entry.inputCount<0||!Number.isInteger(entry.itemCount)||entry.itemCount<0||typeof entry.available!=='boolean')throw new Error('template_record_invalid');
    ids.add(entry.id);return entry;
  });
}
