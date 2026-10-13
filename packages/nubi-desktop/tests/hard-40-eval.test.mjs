import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadHardDomainCases} from '../eval/hard-40/run.mjs';
import {prepareHardWorkspace,configureHardDomainService,documents,mailId,datasetId} from '../eval/hard-40/fixtures.mjs';
import {boundRow,hardDomainChecks} from '../eval/hard-40/grade.mjs';
import {createWorkspace,listFiles,changedPaths} from '../eval/corpus.mjs';
const cases=await loadHardDomainCases(),exec=promisify(execFile);
test('forty isolated hard tasks have ten cases per channel with originals but no answer key',async()=>{
 assert.equal(cases.length,40);
 for(const category of ['bash','mail','skill','wiki'])assert.equal(cases.filter(c=>c.category===category).length,10);
 for(const c of cases){
  const w=await createWorkspace({corpus:'order-service'});
  try{
   await prepareHardWorkspace(c,w);const files=await listFiles(w.root);assert(!files.some(p=>/cases\.json|grade\.mjs|expected/.test(p)));assert.deepEqual(await changedPaths(w.root),[]);
   if(c.category==='bash'){
    const catalog=JSON.parse((await exec('bash',['tools/report.sh','catalog'],{cwd:w.root})).stdout);
    for(const i of [0,1,2]){assert(catalog.some(d=>d.id===datasetId(c,i)));const data=JSON.parse((await exec('bash',['tools/report.sh','read',datasetId(c,i)],{cwd:w.root})).stdout);assert.deepEqual(data.rows,c.datasets[i].rows);assert.equal(data.correction,c.mails[i]);assert.equal(data.policy,c.policies[i]);}
   }else if(c.category==='mail'){
    const service={};await configureHardDomainService(c,service,w);const found=await service.mail({action:'query',query:c.title});assert.equal(found.results.length,9);
    for(let i=0;i<9;i++)assert.equal((await service.mail({action:'read',id:mailId(c,i)})).mail.text,documents(c)[i]);
   }else if(c.category==='wiki')assert.equal(files.filter(p=>p.startsWith('records/')).length,9);
   else assert.deepEqual(JSON.parse(await readFile(w.root+`/.nubi/skill/${c.requiredSkills[0]}/resources/data.json`,'utf8')),c.datasets);
  }finally{await w.dispose();}
 }
});
test('row grading can join same-ID tables but never other IDs; empty results do not pass privacy',()=>{
 const row={id:'G-B',values:[['공개'],['7'],['40']]};assert(boundRow('| G-B | 공개 |\n| G-B | 7 | 40 |',row));assert(!boundRow('| G-B | 공개 |\n| G-A | 7 | 40 |',row));assert(!boundRow('| G-B | 비공개 | 7 | 40 |',row));
 for(const c of cases)assert.equal(hardDomainChecks(c,{state:'waiting_input',answer:'',operations:[]}).find(c=>c.name==='privacy_and_injection').passed,false);
});
