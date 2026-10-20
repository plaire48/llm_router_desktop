// Real existing CLI hosts, existing GenOffice composition and quality coordinator.
// Synthetic business sources; actual draft files, calculation and page images.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {complexBusiness,creationRequest,followupRequest,expected,variants,extraExpected,preservedPlanUnits,preservationPaths} from '../eval/live-complex-cases.mjs';
import {createEvaluationHosts} from '../eval/dual-cli-host.mjs';
import {createQualityInspector} from '../eval/create-quality-inspector.mjs';
import {createHostModelTransport} from '../dist/host-model.js';
import {prepareComposition,reviseComposition,composeWord,composeExcel,composePowerPoint} from '../dist/composition.js';
import {runCompositionQuality} from '../dist/quality.js';
import {createNodeGenOfficeEngine} from './genoffice-node-port.mjs';

const root=resolve(process.argv[2]||'artifacts/live-host-complex-2026-10-17/run-1');
const selected=process.env.NUBI_EVAL_TASKS?.split(',');
const baseline=process.env.NUBI_EVAL_BASELINE?resolve(process.env.NUBI_EVAL_BASELINE):null;
if(baseline===root)throw Error('separate_baseline_required');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hosts=await createEvaluationHosts({requireToolCalls:true});
const engine=createNodeGenOfficeEngine({wordExcelEnginePath:'/Users/ganadi/Documents/office_x/dist/cli/genoffice-engine.cjs',slideEnginePath:resolve('artifacts/hard-business-1/build/slides.cjs')});
await mkdir(root,{recursive:true});
const sourceHashes={};
for(const file of ['src/composition.ts','src/excel.ts','src/excel-formula.ts','src/draft-planning.ts','src/quality.ts','dist/composition.js','dist/quality.js','eval/live-complex-cases.mjs','eval/quality-business-cases.mjs','eval/dual-cli-host.mjs','eval/create-quality-inspector.mjs','eval/quality-reviews.mjs','eval/quality-vision-host.mjs','eval/pdf_text_evidence.py','scripts/render-quality-artifact-v2.py','scripts/render-live-complex.py','scripts/evaluate-live-complex.mjs']) {
  const bytes=await readFile(file);sourceHashes[file]=sha(bytes);const out=join(root,'source',file);await mkdir(dirname(out),{recursive:true});await copyFile(file,out);
}
await writeFile(join(root,'contract.json'),JSON.stringify({kind:'live_existing_hosts_complex_create_and_user_revision',providers:hosts.metadata,sourceHashes,plannedCreate:baseline?0:selected?.length??6,plannedRevision:selected?.length??6,phases:baseline?['revise']:['create','revise'],baseline,repetitions:1,selected:selected||null,reviewProviders:['codex','claude'],maxQualityRepairs:2,initialAttemptsImmutable:true,layoutPresets:false,nativeOfficeVerified:false,createdAt:new Date().toISOString()},null,2),{flag:'wx'});
const controllers=new Set();process.once('SIGINT',()=>{for(const c of controllers)c.abort();});
const jobs=[];
async function task(provider,domain) {
  const id=provider+'-'+domain;if(selected&&!selected.includes(id))return;
  const directory=join(root,id);await mkdir(directory,{recursive:true});
  const c=baseline?JSON.parse(await readFile(join(baseline,id,'business.json'))):complexBusiness(domain),initial=creationRequest(c,domain),ext={word:'docx',excel:'xlsx',powerpoint:'pptx'}[domain];
  await writeFile(join(directory,'business.json'),JSON.stringify(c,null,2));
  const row={id,provider,domain,stages:[],status:'running',startedAt:new Date().toISOString()};jobs.push(row);
  const save=()=>writeFileSync(join(directory,'result.json'),JSON.stringify(row,null,2));save();
  let before=null;
  if(baseline){
    const bytes=await readFile(join(baseline,id,'create','final.'+ext)),plan=JSON.parse(await readFile(join(baseline,id,'create','final-plan.json')));
    await mkdir(join(directory,'create'),{recursive:true});await writeFile(join(directory,'create','final.'+ext),bytes);await writeFile(join(directory,'create','final-plan.json'),JSON.stringify(plan,null,2));
    before={plan,hash:sha(bytes)};row.baselineCreate={directory:join(baseline,id,'create'),artifactHash:before.hash};save();
  }
  for(const phase of baseline?['revise']:['create','revise']) {
    const dir=join(directory,phase);await mkdir(dir,{recursive:true});
    const record={phase,status:'running',rounds:[],rejections:[],calls:[],startedAt:new Date().toISOString()};row.stages.push(record);save();
    const controller=new AbortController();controllers.add(controller);const {signal}=controller,timer=setTimeout(()=>controller.abort(),1800000);
    let turn=0;const host=hosts.host(provider);
    const transport=createHostModelTransport({...host,async complete(messages,tools,context){
      const n=turn++;await writeFile(join(dir,`host-${n}-input.json`),JSON.stringify({messages,tools},null,2));
      const started=Date.now(),reply=await host.complete(messages,tools,context);await writeFile(join(dir,`host-${n}-output.json`),JSON.stringify(reply,null,2));
      record.calls.push({turn:n,ms:Date.now()-started,tools:reply.calls.map(c=>c.function.name)});save();console.log(JSON.stringify({id,phase,event:'host_turn',turn:n,ms:Date.now()-started}));return reply;
    }});
    const onRejectedDraft=(proposal,reason)=>{record.rejections.push({reason});writeFileSync(join(dir,`rejected-${record.rejections.length}.json`),JSON.stringify({proposal,reason},null,2));save();};
    try {
      const request=phase==='create'?initial.request:initial.request+'\n후속 사용자 요청:\n'+followupRequest(domain);
      await writeFile(join(dir,'request.json'),JSON.stringify({request,sources:c},null,2));
      let plan;
      if(phase==='create')plan=await prepareComposition(domain,{request,sources:c},transport,signal,{datasets:c.datasets,validationDetails:true,onRejectedDraft});
      else {
        if(!before)throw Error('initial_draft_missing');
        const revision=await reviseComposition(domain,{request,plan:before.plan,sources:{business:c,userFollowup:followupRequest(domain),preservedOriginalHash:before.hash},datasets:c.datasets},transport,signal,{allowedPaths:[{word:'/blocks',excel:'/sheets',powerpoint:'/slides'}[domain],...(domain==='excel'?['/outputs']:[])],preservePaths:preservationPaths(domain,before.plan),onRejectedDraft});
        plan=revision.plan;await writeFile(join(dir,'user-patches.json'),JSON.stringify(revision.patches,null,2));
      }
      await writeFile(join(dir,'plan-before-quality.json'),JSON.stringify(plan,null,2));
      const business=structuredClone(c);if(phase==='revise'&&domain==='excel')Object.assign(business.metrics,{discountScenario:'추가 할인 총비용',reducedBudgetGap:'예산 축소 잔여'});
      const wants={...expected(c),...(phase==='revise'&&domain==='excel'?extraExpected(c.datasets):{})};
      const inspectBase=createQualityInspector({domain,directory:dir,provider,models:hosts.metadata,business,expectations:wants,requestText:request,reviewProviders:['codex','claude'],inputVariants:variants(c),rendererPath:'scripts/render-live-complex.py'});
      let inspected=0;
      const result=await runCompositionQuality({domain,plan,request,sources:c,datasets:c.datasets,maxRepairs:2,...(phase==='revise'?{preservePaths:preservationPaths(domain,before.plan)}:{})},{transport,
        build:({plan,signal})=>domain==='word'?composeWord(plan,signal,{fontFamily:'Apple SD Gothic Neo'}):domain==='excel'?composeExcel(plan,c.datasets,signal,{fontFamily:'Apple SD Gothic Neo'}):composePowerPoint(plan,engine,signal,{fontFamily:'Apple SD Gothic Neo'}),
        async inspect(candidate){
          const receipt=await inspectBase(candidate);
          if(phase==='revise') {
            const preserved=preservedPlanUnits(domain,before.plan,candidate.candidate.plan);
            const original=sha(await readFile(join(directory,'create','final.'+ext)))===before.hash;
            const check=receipt.checks.find(c=>c.kind==='preservation');check.status=check.status==='passed'&&preserved&&original?'passed':'failed';check.evidence+=' Original draft bytes: '+original+'; unchanged original plan units: '+preserved+'.';
            if(!preserved||!original)receipt.findings.push({code:'unrequested_changes',kind:'preservation',severity:'major',path:{word:'/blocks',excel:'/sheets',powerpoint:'/slides'}[domain],message:'Restore every original plan unit in original order and preserve original header/footer/title and Excel output bindings. Only append the requested new content. Original draft bytes must remain immutable.'});
          }
          await writeFile(join(dir,'round-'+inspected++,'quality-receipt.json'),JSON.stringify(receipt,null,2));return receipt;
        },onRound:r=>{record.rounds.push(r);save();}
      },signal);
      record.status=result.status;record.repairs=result.repairs;record.artifactHash=result.candidate.artifactHash;
      await writeFile(join(dir,'final.'+ext),result.candidate.bytes);await writeFile(join(dir,'final-plan.json'),JSON.stringify(result.candidate.plan,null,2));
      if(phase==='create')before={plan:result.candidate.plan,hash:sha(result.candidate.bytes)};
    } catch(error) {record.status='failed';record.error=error.code??error.message;record.detail=error.detail;}
    finally{clearTimeout(timer);controllers.delete(controller);record.finishedAt=new Date().toISOString();save();}
    console.log(JSON.stringify({id,phase,status:record.status,error:record.error,rounds:record.rounds.length}));
  }
  row.status=row.stages.every(s=>s.status==='verified_draft')?'verified_draft':'needs_improvement';row.finishedAt=new Date().toISOString();save();
}
await Promise.all(['codex','claude'].map(async provider=>{for(const domain of ['powerpoint','word','excel'])await task(provider,domain);}));
await writeFile(join(root,'results.json'),JSON.stringify({jobs,finishedAt:new Date().toISOString(),boundary:'Real existing CLI models; generated plaintext files and LibreOffice rendering/calculation. No Windows Office, COM, NASCA or product save proof.'},null,2));
