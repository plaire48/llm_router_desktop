// Replays recorded model calls, adopted from opencode's http-recorder (MIT License, Copyright (c) 2025 opencode),
// packages/http-recorder/src/http/matching.ts at commit d93568f3. An evaluation run already records every model call
// with its request and response (transcript.jsonl). Replaying serves those responses again, without a model, so a
// harness change can be graded against the same model behavior. Each request takes the first unused recording made
// for the same caller (system prompt) and tool list; a request that matches none fails with the difference to the
// first unused recording. Requests that match but differ after volatile values are normalized are counted as drift.
const LIMIT=8;
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const safeText=value=>{const text=typeof value==='string'?JSON.stringify(value):JSON.stringify(value)??String(value);return text.length>120?text.slice(0,117)+'...':text;};
export function valueDiffs(expected,received,base='$',limit=LIMIT){
 if(Object.is(expected,received))return [];
 if(isRecord(expected)&&isRecord(received))return [...new Set([...Object.keys(expected),...Object.keys(received)])].sort().flatMap(key=>valueDiffs(expected[key],received[key],`${base}.${key}`,limit)).slice(0,limit);
 if(Array.isArray(expected)&&Array.isArray(received))return Array.from({length:Math.max(expected.length,received.length)},(_,index)=>index).flatMap(index=>valueDiffs(expected[index],received[index],`${base}[${index}]`,limit)).slice(0,limit);
 return [`${base} expected ${safeText(expected)}, received ${safeText(received)}`];
}
// Values that change on every run: ids, times, hashes, temporary folders and tool call ids.
const VOLATILE=[
 [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,'<id>'],
 [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g,'<time>'],
 [/sha256:[0-9a-f]{64}|\b[0-9a-f]{40,64}\b/gi,'<hash>'],
 [/(?:\/private)?\/(?:var\/folders|tmp)\/[^\s"'\\]+/g,'<tmp>'],
 [/[A-Za-z]:\\\\[^\s"']*\\\\Temp\\\\[^\s"']+/g,'<tmp>'],
];
export function normalizeRequest(request){
 const ids=new Map(),id=value=>{if(!ids.has(value))ids.set(value,'call_'+ids.size);return ids.get(value);};
 const text=value=>VOLATILE.reduce((out,[pattern,replacement])=>out.replace(pattern,replacement),value);
 const visit=(value,key)=>{
  if(typeof value==='string')return key==='tool_call_id'||key==='id'?id(value):text(value);
  if(Array.isArray(value))return value.map(item=>visit(item));
  if(isRecord(value))return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,visit(item,name)]));
  return value;
 };
 return {messages:visit(request.messages||[]),toolNames:[...(request.toolNames||[])].sort()};
}
const caller=messages=>{const first=(messages||[]).find(message=>message.role==='system');return String(first?.content||'').slice(0,80);};
const signature=request=>caller(request.messages)+'\n'+[...(request.toolNames||[])].sort().join(',');
export function selectFirstMatching(entries,incoming,used){
 let firstUnused;
 for(let index=0;index<entries.length;index++){
  if(used.has(index))continue;
  firstUnused??=entries[index];
  if(signature(entries[index].request)===signature(incoming))return {matched:true,index};
 }
 if(!firstUnused)return {matched:false,detail:`all ${entries.length} recorded calls have already been consumed`};
 return {matched:false,detail:valueDiffs(normalizeRequest(firstUnused.request),normalizeRequest(incoming)).join('\n')};
}
export function replayProviders(entries,{status}={}){
 const recorded=entries.filter(entry=>entry?.request&&(entry.response||entry.error));
 const used=new Set(),drift=[];let own=0,handed=0,sequence=0;
 return {
  status:()=>status||{connected:true,provider:'replay',model:recorded[0]?.model||'replay',models:[{id:recorded[0]?.model||'replay',contextLength:200000}]},
  modelCalls:()=>own,delegatedCalls:()=>handed,dispose(){},
  report:()=>({recorded:recorded.length,served:used.size,unused:recorded.length-used.size,drift}),
  async complete(messages,tools=[]){
   const incoming={messages,toolNames:tools.map(tool=>tool.function?.name)};
   const found=selectFirstMatching(recorded,incoming,used);
   if(!found.matched)throw Object.assign(new Error('cassette_unmatched'),{retryable:false,detail:found.detail});
   used.add(found.index);const entry=recorded[found.index];
   if(entry.delegated)handed++;else own++;
   const differences=valueDiffs(normalizeRequest(entry.request),normalizeRequest(incoming));
   if(differences.length)drift.push({sequence:entry.sequence,differences});
   if(entry.error)throw Object.assign(new Error(entry.error.code||'replayed_error'),{retryable:false,...(Number.isInteger(entry.error.status)?{status:entry.error.status}:{})});
   const call=++sequence;
   return {content:entry.response.content||'',calls:(entry.response.calls||[]).map((item,index)=>({id:`replay_${call}_${index}`,type:'function',function:{name:item.name,arguments:item.arguments}})),finishReason:entry.response.finishReason,...(entry.response.usage?{usage:entry.response.usage}:{})};
  },
 };
}

// node eval/replay.mjs --from <report folder> [--out <folder>] [--cases id,id]: grade the recorded run again with the
// current harness and no model. Drift and unmatched calls show where the harness now asks the model something else.
import {pathToFileURL} from 'node:url';
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {readFile,mkdir,writeFile}=await import('node:fs/promises'),path=(await import('node:path')).default;
 const option=name=>{const index=process.argv.indexOf('--'+name);return index>0?process.argv[index+1]:undefined;};
 const from=option('from');if(!from){console.error('--from 에 녹화한 평가 결과 폴더를 지정해 주세요.');process.exit(2);}
 const report=JSON.parse(await readFile(path.join(from,'report.json'),'utf8'));
 const {loadCases}=await import('./cases.mjs'),{evaluate}=await import('./run.mjs');
 const only=option('cases')?.split(','),out=path.resolve(option('out')||path.join(from,'replay-'+new Date().toISOString().replace(/[:.]/g,'-')));
 await mkdir(out,{recursive:true});const rows=[];
 for(const result of report.results.filter(row=>row.outcome!=='not_run'&&(!only||only.includes(row.id)))){
  const text=await readFile(path.join(from,`${result.id}-t${result.trial}`,'transcript.jsonl'),'utf8').catch(()=>'');
  const providers=replayProviders(text.split('\n').filter(Boolean).map(line=>JSON.parse(line)),{status:{connected:true,provider:report.provider,model:report.model,models:[{id:report.model,contextLength:report.modelConfiguration?.contextLength||200000}]}});
  const [testCase]=await loadCases({ids:[result.id]});
  const replayed=await evaluate({providers,cases:[testCase],outputDir:path.join(out,`${result.id}-t${result.trial}`),candidate:report.candidate});
  const now=replayed.results[0],usage=providers.report();
  rows.push({id:result.id,trial:result.trial,recorded:result.outcome,replayed:now.outcome,served:usage.served,unused:usage.unused,drift:usage.drift.length,error:now.error});
  console.log([now.outcome.padEnd(12),result.id.padEnd(30),'녹화 '+result.outcome.padEnd(12),'사용 '+usage.served+'/'+usage.recorded,'차이 '+usage.drift.length].join(' '));
 }
 await writeFile(path.join(out,'replay.json'),JSON.stringify({from,model:report.model,rows},null,2)+'\n');
 console.log('모델 없이 녹화한 응답으로 다시 채점했습니다. 결과가 달라진 과제는 하네스 변경의 영향입니다.');
}
