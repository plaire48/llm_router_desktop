import {removeLater} from './helpers-cleanup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadMediumCases,summary} from '../eval/medium-40/run.mjs';
import {prepareMediumWorkspace,configureMediumService,datasetId,mailId} from '../eval/medium-40/fixtures.mjs';
import {evidenceChecks,includesFact} from '../eval/medium-40/grade.mjs';
import {createWorkspace,changedPaths} from '../eval/corpus.mjs';
const exec=promisify(execFile);

test('medium suite freezes forty distinct multi-source cases and keeps all cases in the denominator',async()=>{
 const cases=await loadMediumCases();assert.equal(new Set(cases.map(c=>c.request)).size,40);
 for(const row of Object.values(summary(cases.map(c=>({...c,outcome:'not_run',passed:false}))))){assert.equal(row.planned,10);assert.equal(row.notRun,10);}
 for(const c of cases){
  assert.ok(c.expected.every(g=>g.every(x=>typeof x==='string'&&x.length)));
  if(c.category==='bash')assert.equal(c.requiredDatasets.length,2);
  if(c.category==='mail')assert.ok(c.requiredMails.length>=3&&c.mails.length>=5);
  if(c.category==='skill')assert.equal(c.requiredSkills.length,2);
  if(c.category==='wiki')assert.equal(c.requiredPages.length,3);
 }
});

test('Bash fixtures return only raw inputs through separate processes and preserve files',async t=>{
 const w=await createWorkspace({corpus:'order-service'});t.after(()=>w.dispose());
 for(const c of (await loadMediumCases()).filter(c=>c.category==='bash')){
  await prepareMediumWorkspace(c,w);
  const listing=JSON.parse((await exec('bash',['tools/report.sh','catalog'],{cwd:w.root})).stdout);
  for(const i of c.requiredDatasets){
   assert.ok(listing.some(r=>r.id===datasetId(c,i)));
   const output=JSON.parse((await exec('bash',['tools/report.sh','read',datasetId(c,i)],{cwd:w.root})).stdout);
   assert.deepEqual(output.rows,c.datasets[i].rows);assert.equal(output.expected,undefined);assert.equal(output.result,undefined);
  }
  await assert.rejects(exec('bash',['tools/report.sh','read','missing'],{cwd:w.root}));
  assert.deepEqual(await changedPaths(w.root),[]);
  assert.ok(!(await readdir(w.root)).includes('cases.json'));
 }
});

test('gold-looking answers cannot pass without all execution and source receipts',async()=>{
 for(const c of await loadMediumCases())assert.ok(evidenceChecks(c,{answer:c.expected.map(g=>g[0]).join(' ')}).some(x=>!x.passed),c.id);
 const c=(await loadMediumCases())[0],commands=['catalog',...c.requiredDatasets.map(i=>'read '+datasetId(c,i))].map(s=>({script:'bash tools/report.sh '+s,execution:'started',state:'completed',exitCode:0}));
 const run={answer:c.expected.map(g=>g[0]).join(' '),commands};
 assert.ok(evidenceChecks(c,run).every(r=>r.passed));
 assert.equal(evidenceChecks(c,{...run,commands:commands.slice(0,2)}).find(r=>r.name==='multiple_bash_observations').passed,false);
 assert.equal(evidenceChecks(c,{...run,commands:[...commands].reverse()}).find(r=>r.name==='multiple_bash_observations').passed,false);
 assert.equal(includesFact('11700원',['1700원']),false);
 assert.equal(includesFact('1,700원',['1700원']),true);
 assert.equal(includesFact('400',['40']),false);
});

test('all five mail originals are searchable while summaries do not reveal answers',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-medium-mail-'));removeLater(root);
 for(const c of (await loadMediumCases()).filter(c=>c.category==='mail')){
  const service={},stateRoot=path.join(root,c.id);await configureMediumService(c,service,{stateRoot});
  const query=JSON.stringify(await service.mail({action:'query',query:c.title}));
  for(let i=0;i<c.mails.length;i++)assert.ok(query.includes(mailId(c,i)),c.id+' '+i);
  const note=await readFile(path.join(stateRoot,'fixture-personal',mailId(c,4)+'.md'),'utf8');assert.match(note,/原文|원문을 확인/);
 }
});

test('evaluation stops admitting new cases after provider-wide failures, not task errors',async()=>{
 const {shouldStopEvaluation}=await import('../eval/medium-40/run.mjs');
 for(const code of ['rate_limited','worker_disconnected','unauthorized','expired_token','no_credential','claude_login_required'])assert.equal(shouldStopEvaluation(code),true,code);
 for(const code of ['claude_cli_failed','response_invalid','wiki_source_missing',null])assert.equal(shouldStopEvaluation(code),false,code);
});
