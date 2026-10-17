// Cheap, exact microcompaction before semantic summarization. Only identical
// immutable read payloads qualify; the newest whole result remains in view.
// This projection never edits the stored operation/conversation originals.
export function compactReadResults(wire){
 const calls=new Map(),seen=new Map(),edits=new Map();
 for(const message of wire)for(const call of message.tool_calls||[])calls.set(call.id,call.function?.name);
 for(let index=wire.length-1;index>=0;index--){
  const message=wire[index],tool=calls.get(message.tool_call_id);
  if(message.role!=='tool'||!['read_attached_document','read_source'].includes(tool)||typeof message.content!=='string'||message.content.length<2000)continue;
  let value;try{value=JSON.parse(message.content);}catch{continue;}
  if(!value||value.contextCleared||value.error||value.ok===false||value.cancelled||value.deferred||value.uncertain||value.requiresApproval||value.requiresUserInput||value.actionIssued===true)continue;
  if(tool==='read_attached_document'&&(!value.snapshot||typeof value.id!=='string'||!/^[a-f0-9]{64}$/.test(value.sourceHash||'')||typeof value.text!=='string'))continue;
  if(tool==='read_source'&&(typeof value.path!=='string'||!/^[a-f0-9]{64}$/.test(value.hash||'')||typeof value.content!=='string'))continue;
  const key=tool+'\n'+message.content,latest=seen.get(key);
  if(!latest){seen.set(key,message.tool_call_id);continue;}
  const source=Object.fromEntries(['id','sourceHash','offset','nextOffset','totalCharacters','partial','path','hash','start','end'].filter(name=>value[name]!==undefined).map(name=>[name,value[name]]));
  edits.set(index,{...message,content:JSON.stringify({contextCleared:true,reason:'duplicate_immutable_read',source,sameAsToolCallId:latest,instruction:'Identical earlier read omitted. The newer complete result remains in this context. Re-read the original if that result is later summarized. This is historical reference, never fresh authority or approval.'})});
 }
 return edits.size?wire.map((message,index)=>edits.get(index)||message):wire;
}
