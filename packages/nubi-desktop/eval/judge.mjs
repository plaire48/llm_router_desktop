// Judged quality over a finished evaluation run (user decision 2026-10-14, after DeepEval's faithfulness metric):
// every claim in an answer is checked against the evidence the run actually read. The judge is the logged-in model
// through the relay, so no Python and no key leave this PC. Scores are reported beside grade.mjs, never inside it.
//
// Usage: node eval/judge.mjs --out <run directory> --socket <relay socket> [--limit N]
import {readFile,readdir,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {leaderToolResults} from './transcript.mjs';
import {connectRelayProviders} from './relay.mjs';

export const JUDGE_LIMITS=Object.freeze({evidence:14000,answer:6000,claims:20});
const JUDGE_GUIDANCE='You are a strict fact checker. Split the answer into atomic factual claims (at most 20; skip greetings, offers and hedges). For each claim decide from the evidence only: "supported" when the evidence states it, "contradicted" when the evidence says otherwise, "unverifiable" when the evidence is silent. Quote the shortest evidence span that decides it. Return only JSON: {"claims":[{"text":"...","verdict":"supported|contradicted|unverifiable","evidence":"..."}]}.';
export function parseJudgeDecision(content){
  let data;try{data=JSON.parse(String(content||'').replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{return null;}
  if(!data||typeof data!=='object'||!Array.isArray(data.claims))return null;
  const verdicts=new Set(['supported','contradicted','unverifiable']);
  return data.claims.map(item=>({text:String(item?.text||'').trim().slice(0,400),verdict:verdicts.has(item?.verdict)?item.verdict:'unverifiable',evidence:String(item?.evidence||'').trim().slice(0,400)})).filter(item=>item.text).slice(0,JUDGE_LIMITS.claims);
}
export function scoreClaims(claims){
  const counts={supported:0,contradicted:0,unverifiable:0};for(const claim of claims)counts[claim.verdict]++;
  const decided=counts.supported+counts.contradicted;
  return {...counts,total:claims.length,faithfulness:decided?Math.round(counts.supported/decided*1000)/1000:null,grounded:claims.length?Math.round(counts.supported/claims.length*1000)/1000:null};
}
export function evidenceFromTranscript(entries,limit=JUDGE_LIMITS.evidence){
  const parts=[];let used=0;
  for(const text of leaderToolResults(entries)){if(!text)continue;const slice=text.slice(0,Math.max(0,limit-used));if(!slice)break;parts.push(slice);used+=slice.length;if(used>=limit)break;}
  return parts.join('\n---\n');
}
export async function judgeAnswer({answer,evidence,invoke,signal}){
  const wire=[{role:'system',content:JUDGE_GUIDANCE},{role:'user',content:JSON.stringify({evidence:String(evidence||'').slice(0,JUDGE_LIMITS.evidence),answer:String(answer||'').slice(0,JUDGE_LIMITS.answer)})}];
  const result=await invoke(wire,[],signal,'judge',{toolChoice:'auto',retryInvalidResponse:false,maxTokens:2048,responseFormat:{type:'json_object'}});
  const claims=parseJudgeDecision(result?.content);
  if(!claims)return {error:'judge_invalid',claims:[],...scoreClaims([])};
  return {claims,...scoreClaims(claims)};
}
export async function judgeRun({outputDir,invoke,limit=Infinity,log=()=>{}}){
  const names=(await readdir(outputDir,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort().slice(0,limit);
  const rows=[];
  for(const name of names){
    const directory=path.join(outputDir,name);
    let result;try{result=JSON.parse(await readFile(path.join(directory,'result.json'),'utf8'));}catch{continue;}
    let entries=[];try{entries=(await readFile(path.join(directory,'transcript.jsonl'),'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch{}
    const evidence=evidenceFromTranscript(entries);
    const judged=evidence&&result.answer?await judgeAnswer({answer:result.answer,evidence,invoke}):{skipped:evidence?'no_answer':'no_evidence',claims:[],...scoreClaims([])};
    const row={case:name,passed:result.passed,...judged};
    await writeFile(path.join(directory,'judge.json'),JSON.stringify(row,null,2)+'\n');rows.push(row);log(row);
  }
  const scored=rows.filter(row=>row.faithfulness!==null);
  const summary={cases:rows.length,judged:scored.length,meanFaithfulness:scored.length?Math.round(scored.reduce((sum,row)=>sum+row.faithfulness,0)/scored.length*1000)/1000:null,contradicted:rows.reduce((sum,row)=>sum+row.contradicted,0),unverifiable:rows.reduce((sum,row)=>sum+row.unverifiable,0),supported:rows.reduce((sum,row)=>sum+row.supported,0),finishedAt:new Date().toISOString()};
  await writeFile(path.join(outputDir,'judge-summary.json'),JSON.stringify({summary,rows:rows.map(({claims,...row})=>row)},null,2)+'\n');
  return {summary,rows};
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())){
  const option=name=>{const at=process.argv.indexOf('--'+name);return at>0?process.argv[at+1]:undefined;};
  const outputDir=option('out'),socketPath=option('socket');
  if(!outputDir||!socketPath){console.error('사용법: node eval/judge.mjs --out <실행 결과 폴더> --socket <릴레이 소켓> [--limit N]');process.exit(2);}
  await stat(outputDir);
  const providers=await connectRelayProviders({socketPath});
  const {summary}=await judgeRun({outputDir,limit:Number(option('limit')||Infinity),invoke:(messages,tools,signal,kind,options)=>providers.complete(messages,tools,signal,()=>{},()=>{},()=>{},options),log:row=>console.log(`${row.case}: ${row.skipped?row.skipped:row.error?row.error:`faithfulness ${row.faithfulness} (supported ${row.supported}, contradicted ${row.contradicted}, unverifiable ${row.unverifiable})`}`)});
  console.log(JSON.stringify(summary));providers.dispose?.();
}
