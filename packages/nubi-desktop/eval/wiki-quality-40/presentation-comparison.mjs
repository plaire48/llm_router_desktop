import {readFile,writeFile} from 'node:fs/promises';
import {createClaudeCode,runClaude} from '../../runtime/claude-code.mjs';
import {leaderEntries} from '../transcript.mjs';
export const LOOKUP_PRESENTATION='For user-facing knowledge lookups, honor the host brevity instruction literally: answer in 1-3 sentences with decisive citations inline, unless the user asks for a detailed report or a comparison needing a table. Do not repeat the same answer in a table and prose. Do not append source inventories, routine verification narration, unrelated missing fields or generic audit disclaimers. Retain uncertainty, conflicting evidence and conditions that materially change the answer, and all required approval scope. This presentation rule never changes tool proposals or requested JSON output.';
const claude=createClaudeCode({run:(binary,args,options)=>{const actual=[...args],at=actual.indexOf('--system-prompt');if(at>=0)actual[at+1]+='\n'+LOOKUP_PRESENTATION;return runClaude(binary,actual,options);}});
const results=[];
try{
 await claude.connect();claude.model('claude-opus-5-5');claude.reasoning('medium');
 for(const [group,id] of [[1,'code-06'],[3,'personal-09'],[3,'personal-12']]){
  const original=JSON.parse(await readFile(`verification/openwiki-quality-2026-10-15/final-${group}/${id}-trial1.json`));
  const entry=leaderEntries(original.transcript).findLast(e=>e.response?.content&&!e.response?.calls?.length);
  for(let trial=1;trial<=2;trial++){
   const start=Date.now(),result=await claude.complete(entry.request.messages,[]);
   results.push({id,trial,baseline:original.answer,candidate:result.content,calls:result.calls,baselineCharacters:original.answer.length,candidateCharacters:result.content.length,elapsedMs:Date.now()-start});console.log(id+' '+trial+' '+result.content.length);
  }
 }
}finally{claude.disconnect();}
await writeFile('verification/openwiki-quality-2026-10-15/presentation-comparison.json',JSON.stringify({scope:'Same observed final-turn inputs, no tools available in replay. Adapter-prompt experiment only; not full agent evaluation.',instruction:LOOKUP_PRESENTATION,results},null,2)+'\n');
