// Post-run diagnostics only. Never overwrite the frozen score or raw transcript.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {leaderEntries,leaderToolResults} from '../transcript.mjs';
const dir=path.resolve(process.argv[2]||'verification/eval-live/hard40-v1-trial1-20261013');
const report=JSON.parse(await readFile(path.join(dir,'report.json'),'utf8'));
const rows=[];
for(const result of report.results.filter(r=>r.outcome!=='not_run')){
 let transcript=[];try{transcript=(await readFile(path.join(dir,result.id,'transcript.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch{}
 const toolErrors=leaderToolResults(transcript).map(text=>{try{return JSON.parse(text);}catch{return null;}}).filter(r=>r?.ok===false||r?.error).map(r=>({error:r.error,details:r.details??null,instruction:r.instruction||''}));
 const entries=leaderEntries(transcript),calls=entries.flatMap(e=>e.response?.calls||[]),toolCounts={},identical=new Map();
 for(const call of calls){toolCounts[call.name]=(toolCounts[call.name]||0)+1;let arg=call.arguments;try{arg=JSON.stringify(JSON.parse(arg));}catch{}const key=call.name+' '+arg;identical.set(key,(identical.get(key)||0)+1);}
 const roleCounts={};for(const e of transcript){const system=e.request?.messages?.find(m=>m.role==='system')?.content||'';const role=e.delegated?'openwiki':system.startsWith('Nubi Desktop independent result review')?'final_review':system.startsWith('You are Nubi Desktop')?'main':'other';roleCounts[role]=(roleCounts[role]||0)+1;}
 const visible=String(result.answer||'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1');
 const cited=(result.sourceReferences||[]).filter(ref=>ref.href&&result.answer?.includes(ref.href));
 const scripts=(result.commands||[]).filter(c=>c.execution==='started').map(c=>c.script),counts=new Map();for(const s of scripts)counts.set(s,(counts.get(s)||0)+1);
 rows.push({id:result.id,outcome:result.outcome,failedChecks:result.checks?.filter(c=>!c.passed),seconds:Math.round((result.elapsedMs||0)/1000),mainCalls:result.modelCalls,delegatedCalls:result.delegatedCalls,visibleCharacters:visible.length,nonemptyLines:visible.split('\n').filter(Boolean).length,firstParagraph:visible.split(/\n\s*\n/)[0],sourceReferences:result.sourceReferences?.length||0,visibleCitationTargets:cited.length,roleCounts,toolErrors,approvedCommands:result.user?.commands?.length||0,toolCounts,identicalLeaderCalls:[...identical].filter(([,n])=>n>1),repeatedCommands:[...counts].filter(([,n])=>n>1),modelErrors:transcript.filter(e=>e.error).map(e=>({sequence:e.sequence,error:e.error})),slowestModelCalls:transcript.toSorted((a,b)=>b.elapsedMs-a.elapsedMs).slice(0,3).map(e=>({sequence:e.sequence,seconds:Math.round(e.elapsedMs/1000),delegated:e.delegated===true,toolNames:(e.response?.calls||[]).map(c=>c.name)}))});
}
await writeFile(path.join(dir,'diagnostics.json'),JSON.stringify({generatedAt:new Date().toISOString(),frozenBenchmarkHash:report.benchmarkHash,rows},null,2)+'\n');
console.log(JSON.stringify(rows.map(({id,outcome,seconds,mainCalls,delegatedCalls,visibleCharacters,visibleCitationTargets,failedChecks,repeatedCommands})=>({id,outcome,seconds,mainCalls,delegatedCalls,visibleCharacters,visibleCitationTargets,failed:failedChecks?.map(c=>c.name),repeatedCommands})),null,2));
