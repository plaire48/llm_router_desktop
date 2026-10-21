import {removeLater} from './helpers-cleanup.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {parseJudgeDecision,scoreClaims,evidenceFromTranscript,judgeAnswer,judgeRun} from '../eval/judge.mjs';
test('judge decisions are parsed strictly and scored on decided claims only',()=>{
  assert.equal(parseJudgeDecision('x'),null);assert.equal(parseJudgeDecision('{"claims":1}'),null);
  const claims=parseJudgeDecision('```json\n{"claims":[{"text":"배포는 금요일","verdict":"supported","evidence":"매주 금요일 배포"},{"text":"담당자는 김","verdict":"contradicted"},{"text":"","verdict":"supported"},{"text":"내일 비가 온다","verdict":"maybe"}]}\n```');
  assert.deepEqual(claims.map(claim=>claim.verdict),['supported','contradicted','unverifiable']);
  assert.deepEqual(scoreClaims(claims),{supported:1,contradicted:1,unverifiable:1,total:3,faithfulness:0.5,grounded:0.333});
  assert.deepEqual(scoreClaims([]),{supported:0,contradicted:0,unverifiable:0,total:0,faithfulness:null,grounded:null});
});
test('a run directory is judged case by case from the tool results the leader read',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-judge-'));removeLater(dir);
  const entry={request:{messages:[{role:'system',content:'You are Nubi Desktop. Reply in Korean.'},{role:'tool',content:'배포는 매주 금요일에 한다.'}]}};
  for(const [name,answer] of [['c1','배포는 금요일이고 담당자는 김민수입니다.'],['c2','']]){await mkdir(path.join(dir,name));await writeFile(path.join(dir,name,'result.json'),JSON.stringify({passed:true,answer}));await writeFile(path.join(dir,name,'transcript.jsonl'),JSON.stringify(entry)+'\n');}
  assert.match(evidenceFromTranscript([entry]),/금요일/);assert.equal(evidenceFromTranscript([entry],3),'배포는');
  const calls=[];
  const {summary,rows}=await judgeRun({outputDir:dir,invoke:async(wire,tools,signal,kind,options)=>{calls.push({kind,options});assert.match(wire[1].content,/evidence/);return {content:JSON.stringify({claims:[{text:'배포는 금요일',verdict:'supported'},{text:'담당자는 김민수',verdict:'unverifiable'}]})};}});
  assert.equal(calls.length,1);assert.equal(calls[0].kind,'judge');
  assert.deepEqual(rows.map(row=>[row.case,row.faithfulness,row.skipped||null]),[['c1',1,null],['c2',null,'no_answer']]);
  assert.deepEqual({cases:summary.cases,judged:summary.judged,meanFaithfulness:summary.meanFaithfulness,unverifiable:summary.unverifiable},{cases:2,judged:1,meanFaithfulness:1,unverifiable:1});
  assert.equal(JSON.parse(await readFile(path.join(dir,'c1','judge.json'),'utf8')).claims.length,2);
  assert.equal(JSON.parse(await readFile(path.join(dir,'judge-summary.json'),'utf8')).rows[0].claims,undefined);
  const broken=await judgeAnswer({answer:'a',evidence:'b',invoke:async()=>({content:'nope'})});assert.equal(broken.error,'judge_invalid');
});
