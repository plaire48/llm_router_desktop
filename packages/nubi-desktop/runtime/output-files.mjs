import {randomUUID} from 'node:crypto';
import {lstat,realpath} from 'node:fs/promises';
import {fail,relativeFile,scopedFile} from './files.mjs';
import {readCapture} from './captures.mjs';
import {cleanModelText} from './model-text.mjs';

export const OUTPUT_LIMIT=5;
const kindOf=name=>/\.(png|jpe?g|gif|webp)$/i.test(name)?'image':/\.pdf$/i.test(name)?'pdf':/\.(docx|xlsx|pptx)$/i.test(name)?'office':'text';
// The image stays in the host capture store, never in task/message snapshots.
export function outputCapture(service,task,card){
 let record;try{record=readCapture(service,card.captureId);}catch{fail('output_invalid');}
 if(!card.runId||record.taskId!==task.id||record.runId!==card.runId)fail('output_invalid');
 return record;
}
export async function registerOutput(service,task,{path:input,captureId,caption='',runId}={}){
 if(!task?.id||typeof runId!=='string'||!runId||typeof caption!=='string'||(input!==undefined)===(captureId!==undefined))fail('output_invalid');
 const cleanCaption=cleanModelText(caption);if(caption&&!cleanCaption)fail('output_invalid');
 let file;
 if(captureId!==undefined){const record=outputCapture(service,task,{captureId,runId});file={captureId,name:'화면 캡처.png',size:Buffer.byteLength(record.image,'base64'),kind:'image'};}
 else {
  if(typeof input!=='string')fail('output_invalid');const relative=input.replace(/\\/g,'/');
  try{relativeFile(relative);}catch{fail('output_outside');}
  let absolute;try{absolute=await scopedFile(await realpath(service.root),relative);}catch(error){fail(error.message==='path_scope'?'output_outside':'output_invalid');}
  const info=await lstat(absolute).catch(()=>null);if(!info?.isFile()||info.isSymbolicLink())fail('output_invalid');
  file={path:relative,size:info.size,kind:kindOf(relative)};
 }
 // No await between checking the quota and appending, including parallel tool calls.
 task.outputs=Array.isArray(task.outputs)?task.outputs:[];
 if(task.outputs.filter(row=>row.runId===runId).length>=OUTPUT_LIMIT)fail('output_card_limit');
 const card={id:randomUUID(),...file,caption:cleanCaption.slice(0,160),runId,at:new Date().toISOString()};task.outputs.push(card);return card;
}
