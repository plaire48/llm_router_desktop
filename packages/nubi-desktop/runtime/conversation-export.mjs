import {workflowChapters} from './workflow-chapters.mjs';
import {secretLike} from './secret-like.mjs';
// Export is a projection of saved conversation records, never tool execution.
const credential=/(?:password|passwd|secret|token|authorization|cookie|api[_-]?key|client[_-]?key|access[_-]?key)(?:[\w-]*["']?)\s*(?:[:=]|\s+)|\bBearer\s+\S+|https?:\/\/[^\s/]+:[^\s/]+@/i;
export const safeText=value=>String(value??'').replace(/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g,'[인증값 포함 내용 숨김]').split(/\r?\n/).map(line=>(credential.test(line)||secretLike(line)||/(?:^|\s)(?:-u|--user|--proxy-user)(?:[=\s]+|(?=[\"']))\S+|\bBasic\s+[A-Za-z0-9+/]{8,}={0,2}/i.test(line))?'[인증값 포함 내용 숨김]':line).join('\n');
const line=value=>safeText(value).replace(/[\r\n\t]+/g,' ').replace(/[<>&]/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[char]));
function argumentText(entry){
 let args=entry.args;
 if(!args&&typeof entry.arguments?.text==='string'){try{args=JSON.parse(entry.arguments.text);}catch{}}
 if(!args||Array.isArray(args)||typeof args!=='object')return '';
 return ['path','query','script','title'].filter(key=>typeof args[key]==='string').map(key=>line(args[key])).join(' ');
}
export function conversationFilename(task){
 const name=safeText(task.request||'대화').replace(/[\\/:*?"<>|\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().replace(/^[. ]+|[. ]+$/g,'').slice(0,70)||'대화';
 return `누비-${task.origin?.kind==='side_task'?'에이전트 제안-':''}${name}.md`;
}
export function conversationMarkdown(task,{workflowRun}={}){
 const requestHeading=task.origin?.kind==='side_task'?'## 요청 (에이전트 제안)':'## 요청';
 const messages=Array.isArray(task.messages)?task.messages:[],trace=Array.isArray(task.trace)?task.trace:[];
 const chunks=[`# ${line(task.request||'대화')}`,line(task.createdAt||'')],emitted=new Set();
 const records=runId=>{const rows=trace.filter(row=>row.runId===runId&&!emitted.has(row));if(!rows.length)return;for(const row of rows)emitted.add(row);chunks.push('<details>\n<summary>도구 기록</summary>\n\n'+rows.map(row=>`- ${line(row.tool||'도구')}${argumentText(row)?' '+argumentText(row):''}${row.status?' ('+line(row.status)+')':''}`).join('\n')+'\n\n</details>');};
 if(messages[0]?.role!=='user'||messages[0]?.content!==task.request)chunks.push(requestHeading,safeText(task.request));
 for(let i=0;i<=messages.length;i++){
  for(const chapter of (task.kind==='workflow'&&workflowRun?[]:task.chapters||[]))if(chapter.messageIndex===i)chunks.push('## '+line(chapter.title));
  const message=messages[i];if(!message||!['user','assistant'].includes(message.role))continue;
  if(message.role==='assistant')records(message.runId);
  chunks.push(message.role==='user'?(i===0&&message.content===task.request?requestHeading:'## 요청'):'## 답',safeText(message.content));
 }
 for(const row of trace)if(!emitted.has(row))records(row.runId);
 if(task.kind==='workflow'&&workflowRun){
  for(const chapter of workflowChapters(workflowRun)){
   const step=workflowRun.workflow.steps.find(row=>row.id===chapter.stepId),checkpoint=workflowRun.steps?.[chapter.stepId]||{};
   chunks.push('## '+line(chapter.title),'상태: '+line(chapter.status));
   if(step.action_summary)chunks.push(safeText(step.action_summary));
   if(checkpoint.reason)chunks.push('사유: '+line(checkpoint.reason));
   if(checkpoint.answer)chunks.push('답변: '+safeText(typeof checkpoint.answer==='string'?checkpoint.answer:JSON.stringify(checkpoint.answer)));
   if(checkpoint.receipts?.length)chunks.push('영수증: '+checkpoint.receipts.map(line).join(', '));
  }
  if(workflowRun.report)chunks.push('## 실행 보고서',safeText(workflowRun.report));
 }
 const refs=new Map();for(const ref of [...(task.requestMailReferences||[]),...(task.mailReferences||[]),...messages.flatMap(message=>message.mailReferences||[])])if(typeof ref?.id==='string')refs.set(ref.id,ref);
 if(refs.size)chunks.push('## 메일 참조',[...refs.values()].map(ref=>`- ${line(ref.title||'메일')} (${line(ref.id)})`).join('\n'));
 return chunks.filter(Boolean).join('\n\n')+'\n';
}
