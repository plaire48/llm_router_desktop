// File proposals arrive in the model's own field names (user report 2026-10-14: "새 파일 제안 입력 형식" kept failing):
// file_path or filename for path, contents or code for content, rationale for reason, a list of lines, or a key the
// tool does not have. These are mapped onto the schema before validation. A missing reason is taken from the recorded
// change plan's reason for the same path; nothing else is invented, and paths and text are never rewritten.
const ALIASES={
  path:['file','file_path','filePath','filename','fileName','target','targetPath','target_path'],
  content:['contents','text','code','body','source','new_content','newContent','file_content','fileContent'],
  reason:['rationale','why','description','summary','explanation','message'],
  expectedHash:['hash','sha','expected_hash','currentHash','current_hash','fileHash'],
  edits:['changes','replacements','patches','patch'],
};
const EDIT_ALIASES={oldText:['old','old_text','search','find','before','original','from'],newText:['new','new_text','replace','replacement','after','to'],replaceAll:['replace_all','all']};
const FIELDS={propose_new_file:['path','content','reason'],propose_edit:['path','expectedHash','content','reason','lineEndings'],propose_patch:['path','expectedHash','edits','reason','matching']};
const isObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const lines=value=>Array.isArray(value)&&value.every(item=>typeof item==='string')?value.join('\n'):value;
function mapKeys(value,aliases,allowed){
  if(!isObject(value))return value;
  const out={};
  for(const name of allowed){
    if(Object.hasOwn(value,name)){out[name]=value[name];continue;}
    const alias=(aliases[name]||[]).find(key=>Object.hasOwn(value,key));
    if(alias!==undefined)out[name]=value[alias];
  }
  return out;
}
export function normalizeProposalArgs(name,args,task){
  const fields=FIELDS[name];
  if(!fields||!isObject(args))return args;
  const out=mapKeys(args,ALIASES,fields);
  if(Object.hasOwn(out,'content'))out.content=lines(out.content);
  if(Array.isArray(out.edits))out.edits=out.edits.map(edit=>{const mapped=mapKeys(edit,EDIT_ALIASES,['oldText','newText','replaceAll']);if(isObject(mapped)){mapped.oldText=lines(mapped.oldText);mapped.newText=lines(mapped.newText);}return mapped;});
  if(typeof out.reason!=='string'||!out.reason.trim()){
    const planned=task?.changePlan?.targets?.find(target=>target.path===out.path)?.reason;
    if(typeof planned==='string'&&planned.trim())out.reason=planned;
  }
  if(typeof out.reason==='string'&&out.reason.length>2000)out.reason=out.reason.slice(0,1999)+'…';
  return out;
}
