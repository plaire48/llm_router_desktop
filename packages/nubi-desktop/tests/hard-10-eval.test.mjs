import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createWorkspace,changedPaths,listFiles} from '../eval/corpus.mjs';
import {prepareHardWorkspace,configureHardService,datasetId,mailId} from '../eval/hard-10/fixtures.mjs';
import {hasFact,rowMatches,exposed,hardChecks} from '../eval/hard-10/grade.mjs';
import {loadHardCases,summary} from '../eval/hard-10/run.mjs';
const exec=promisify(execFile),cases=await loadHardCases();
test('hard10 freezes ten four-source tasks with answer keys outside workspaces',async()=>{
 assert.equal(cases.length,10);
 for(const c of cases){
  assert.deepEqual(c.requiredDatasets,[0,1,2]);assert.deepEqual(c.requiredMails,[0,1,2]);assert.deepEqual(c.requiredPages,[0,1,2]);assert.equal(c.requiredSkills.length,2);
  const w=await createWorkspace({corpus:'order-service'});
  try{
   await prepareHardWorkspace(c,w);assert.deepEqual(await changedPaths(w.root),[]);
   const files=await listFiles(w.root);assert(!files.some(p=>/cases\.json|grade\.mjs|expected/.test(p)));
   const {stdout}=await exec('bash',['tools/report.sh','catalog'],{cwd:w.root});const catalog=JSON.parse(stdout);
   for(const i of c.requiredDatasets){assert(catalog.some(r=>r.id===datasetId(c,i)));const result=JSON.parse((await exec('bash',['tools/report.sh','read',datasetId(c,i)],{cwd:w.root})).stdout);assert.deepEqual(result.rows,c.datasets[i].rows);}
   const service={};await configureHardService(c,service,w);
   const body=await service.mail({action:'read',id:mailId(c,0)});assert.equal(body.mail.text,c.mails[0]);const matches=await service.mail({action:'query',query:c.title});assert.deepEqual(matches.results.map(r=>r.id).sort(),c.requiredMails.map(i=>mailId(c,i)).sort());
   assert.deepEqual(await changedPaths(w.root),[]);
  }finally{await w.dispose();}
 }
});
test('hard grader rejects wrong numeric bindings, substring verdicts and private IDs but ignores link targets',()=>{
 assert(!hasFact('비공개',['공개']));assert(!hasFact('불가능',['가능']));assert(!hasFact('18:20',['20']));assert(!hasFact('R1',['1']));assert(!hasFact('NO-GO',['GO']));assert(hasFact('GO',['GO']));assert(!hasFact('1,600,000원',['600000']));
 assert(rowMatches('| P-A | 600,000원 | 400,000원 |',{id:'P-A',values:[['600000'],['400000']]}));
 assert(!rowMatches('| P-A | 700,000원 |\n| P-B | 600,000원 |',{id:'P-A',values:[['600000']]}));
 assert.deepEqual(exposed('[근거](https://example.test/B1)\nB12', ['B1']),[]);assert.deepEqual(exposed('참여자 B1', ['B1']),['B1']);
 assert.equal(hardChecks(cases[0],{state:'review',answer:'R1 NO-GO smoke\nR2 NO-GO 철회\nR3 GO\n묶음 불가'}).filter(c=>c.passed).length<14,true);
 assert.deepEqual(summary(cases.map(c=>({id:c.id,outcome:'not_run'}))).notRun,10);
});
test('independent accounting and interval oracles validate the frozen hard gold',()=>{
 const c2=cases[1],latest=new Map();for(const r of c2.datasets[0].rows)if((latest.get(r.id)?.rev||0)<r.rev)latest.set(r.id,r);
 const payments=[...new Map(c2.datasets[1].rows.filter(r=>r.state==='confirmed').map(r=>[r.event,r])).values()];
 const due=id=>[...latest.values()].filter(r=>r.customer===id).reduce((s,r)=>s+r.amount*({KRW:1,USD:1350}[r.currency]??NaN),0)-payments.filter(r=>r.customer===id).reduce((s,r)=>s+r.amount,0)-c2.datasets[2].rows.filter(r=>r.customer===id&&r.state==='approved').reduce((s,r)=>s+r.amount,0);
 assert.equal(due('A'),385000);assert.equal(due('B'),100000);assert(Number.isNaN(due('C')));
 const unplanned=Array.from({length:60},(_,i)=>i).filter(m=>m<18&&!(m>=10&&m<15)).length;
 assert.equal(unplanned,13);assert.equal(((55-unplanned)/55*100).toFixed(2),'76.36');
 const jobs=[{g:4,s:18*60,e:18*60+40},{g:3,s:18*60+20,e:19*60},{g:2,s:18*60+40,e:19*60+10}],cap=m=>m<19*60?6:8;
 assert.equal(Array.from({length:90},(_,i)=>18*60+i).reduce((sum,m)=>sum+Math.max(0,jobs.filter(j=>j.s<=m&&m<j.e).reduce((n,j)=>n+j.g,0)-cap(m)),0),20);
 const start=Array.from({length:31},(_,i)=>18*60+20+i).find(s=>Array.from({length:40},(_,i)=>s+i).every(m=>3+jobs.filter((j,i)=>i!==1&&j.s<=m&&m<j.e).reduce((n,j)=>n+j.g,0)<=cap(m)));
 assert.equal(start,18*60+40);
 const c8=cases[7],withdrawn=new Set(c8.datasets[2].rows.map(r=>r.id)),valid=new Set(c8.datasets[1].rows.filter(r=>r.consent&&!withdrawn.has(r.id)).map(r=>r.id));
 const values=g=>c8.datasets[0].rows.filter(r=>r.group===g&&valid.has(r.id)).map(r=>r.score);
 assert.deepEqual(['G-A','G-B','G-C'].map(g=>values(g).length),[4,7,4]);assert.equal(values('G-B').reduce((a,b)=>a+b)/7,40);
 assert.equal((3.5-.5)*10000*2,60000);assert.equal((3-.5)*10000*1.25,31250);assert.equal(60000+31250,91250);
});
