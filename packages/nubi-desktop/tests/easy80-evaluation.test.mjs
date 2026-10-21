import {removeLater} from './helpers-cleanup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadEasyCases,summary} from '../eval/easy-80/run.mjs';
import {prepareEasyWorkspace,configureEasyService,dataId,mailId} from '../eval/easy-80/fixtures.mjs';
import {evidenceChecks,includesFact} from '../eval/easy-80/grade.mjs';
import {createWorkspace,changedPaths} from '../eval/corpus.mjs';
const exec=promisify(execFile);

test('easy suite freezes twenty distinct cases per category and preserves all eighty in the denominator',async()=>{
 const cases=await loadEasyCases();assert.equal(new Set(cases.map(c=>c.request)).size,80);
 const report=summary(cases.map(c=>({...c,outcome:'not_run',passed:false})));
 for(const row of Object.values(report)){assert.equal(row.planned,20);assert.equal(row.notRun,20);assert.equal(row.passed,0);}
});

test('all twenty Bash tools compute their oracle from source inputs without changing the workspace',async t=>{
 const w=await createWorkspace({corpus:'order-service'});t.after(()=>w.dispose());
 for(const c of (await loadEasyCases()).filter(c=>c.category==='bash')){
  await prepareEasyWorkspace(c,w);
  const listing=JSON.parse((await exec('bash',['tools/report.sh','catalog'],{cwd:w.root})).stdout);
  assert.ok(listing.some(r=>r.id===dataId(c)&&r.title===c.title));
  const output=(await exec('bash',['tools/report.sh','run',dataId(c)],{cwd:w.root})).stdout;
  assert.ok(c.expected.every(g=>includesFact(output,g)),c.id+' '+output);
  assert.deepEqual(await changedPaths(w.root),[]);
  assert.ok(!(await readdir(w.root)).includes('cases.json'),'answer key stays outside workspace');
 }
});

test('a correct-looking answer cannot pass without actual commands, source citations or relevant skill reads',async()=>{
 const cases=await loadEasyCases();
 for(const category of ['bash','mail','skill','wiki']){
  const c=cases.find(c=>c.category===category),checks=evidenceChecks(c,{answer:c.expected.map(g=>g[0]).join(' ')});
  assert.ok(checks.some(x=>!x.passed),category);
 }
 const c=cases.find(c=>c.category==='bash');
 const commands=[{script:'bash tools/report.sh catalog',execution:'started',state:'completed',exitCode:0},{script:'bash tools/report.sh run '+dataId(c),execution:'started',state:'completed',exitCode:0}];
 assert.ok(evidenceChecks(c,{answer:'53,000',commands}).every(r=>r.passed));
 assert.equal(evidenceChecks(c,{answer:'53000',commands:[...commands].reverse()}).find(r=>r.name==='multiple_bash_observations').passed,false);
});

test('mail fixtures expose real local Personal Wiki queries and separate original mail reads',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-easy80-mail-'));removeLater(root);
 const c=(await loadEasyCases()).find(c=>c.category==='mail'),service={};await configureEasyService(c,service,{stateRoot:root});
 const query=await service.mail({action:'query',query:c.title});assert.ok(JSON.stringify(query).includes(mailId(c,0)));
 const files=await readdir(path.join(root,'fixture-personal'));assert.equal(files.length,4);
 assert.match(await readFile(path.join(root,'fixture-personal',mailId(c,0)+'.md'),'utf8'),/원문을 확인/);
});

test('an already-advertised relevant skill needs no redundant discovery call',async()=>{
 const c=(await loadEasyCases()).find(c=>c.category==='skill'),skillPath=`.nubi/skill/${c.skill}/SKILL.md`;
 const run={answer:c.expected.map(g=>g[0]).join(' '),operations:[{tool:'use_skill',state:'completed',path:skillPath}],transcript:[{request:{messages:[{role:'system',content:JSON.stringify({skills:[{path:skillPath}]})}]}}]};
 assert.ok(evidenceChecks(c,run).every(row=>row.passed));
 run.operations[0].path='.nubi/skill/wrong/SKILL.md';assert.equal(evidenceChecks(c,run).find(row=>row.name==='relevant_skill_read').passed,false);
});

test('v2 clarifies ambiguous inputs without rewriting the original suite',async()=>{
 const first=await loadEasyCases(),second=await loadEasyCases(2);
 assert.equal(second.length,80);assert.equal(first.find(c=>c.id==='bash-09').inputUnit,undefined);
 assert.equal(second.find(c=>c.id==='bash-09').inputUnit,'seconds');
 assert.match(second.find(c=>c.id==='skill-06').request,/배포 안내문/);
 assert.match(second.find(c=>c.id==='skill-10').request,/고객에게 보낼 답변 초안만/);
 for(const c of first.filter(c=>!['bash-09','skill-06','skill-10'].includes(c.id)))assert.equal(second.find(v=>v.id===c.id).request,c.request);
});
