// Document forms baseline (document forms plan Task G, 2026-10-21): synthetic Word forms filled through the product
// path (documentForm register → plan → answer → apply) with the model the user is logged in to, graded by code:
// the copy opens (parsed, and converted by LibreOffice when it is installed), nothing outside the targets changed, the
// expected values are in their cells, no guide text is left, and a value the request does not give is asked.
// Synthetic forms and requests only; no company data.
//
// Usage: node eval/document-forms/run.mjs --out <dir> [--model claude-sonnet-5-5] [--only id,id]
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Dates are compared as number sequences: 2026. 11. 3. and 2026년 11월 03일 are the same date.
const numbersOf=text=>(String(text??'').match(/\d+/g)??[]).map(Number);
const holds=(text,numbers)=>{const found=numbersOf(text);return found.some((_,i)=>numbers.every((n,k)=>found[i+k]===n));};
const has=(text,part)=>String(text??'').replace(/\s+/g,'').includes(String(part).replace(/\s+/g,''));
// expected: {cells:{target:{text?|numbers?}}, sections:{title:[words]}, asks:[slot]}
export const CASES=[
  {id:'gianmun',form:'gianmun',name:'기안문',request:'기안문을 작성해 주세요. 문서번호는 영업팀-2026-014, 기안일자는 2026. 10. 21., 기안자는 김민수, 결재는 박지영 팀장, 수신은 경영지원팀, 제목은 하반기 거래처 방문 계획입니다. 개요: 하반기 주요 거래처 5곳을 방문해 계약을 갱신합니다. 추진 내용: 11월 첫째 주 부산, 둘째 주 대구를 방문합니다. 행정 사항: 출장비는 영업팀 예산으로 처리합니다.',
    expected:{cells:{'t1/r1/c2':{text:'영업팀-2026-014'},'t1/r1/c4':{numbers:[2026,10,21]},'t1/r2/c2':{text:'김민수'},'t1/r2/c4':{text:'박지영'},'t1/r3/c2':{text:'경영지원팀'},'t1/r4/c2':{text:'하반기 거래처 방문 계획'}},sections:{'1. 개요':['거래처'],'2. 추진 내용':['부산','대구'],'3. 행정 사항':['예산']}}},
  {id:'trip',form:'trip',name:'출장 보고',request:'출장 결과 보고서를 써 주세요. 출장자 이서준, 소속 기술지원팀, 출장지 대전 연구단지, 출장 기간 2026. 10. 14. ~ 2026. 10. 15. 주요 일정은 10. 14. 10:00 장비 점검, 10. 14. 15:00 고객 회의, 10. 15. 09:00 결과 정리입니다. 출장 목적은 연구단지 장비 정기 점검입니다. 결과 및 향후 계획: 점검 결과 이상 없음, 다음 점검은 12월.',
    expected:{cells:{'t1/r1/c2':{text:'이서준'},'t1/r1/c4':{text:'기술지원팀'},'t1/r2/c2':{text:'대전'},'t1/r3/c2':{numbers:[2026,10,14,2026,10,15]},'t2/r2/c3':{text:'장비 점검'},'t2/r3/c3':{text:'고객 회의'},'t2/r4/c3':{text:'결과 정리'}},sections:{'1. 출장 목적':['점검'],'3. 결과 및 향후 계획':['12월']}}},
  {id:'pumui',form:'pumui',name:'품의서',request:'품의서를 작성해 주세요. 품의 번호 구매-2026-031, 품의 일자 2026. 10. 20., 품의 부서 총무팀, 품의자 정하늘, 건명은 회의실 의자 교체, 금액은 1,200,000원, 내용은 노후 의자 10개를 새 의자로 교체합니다.',
    expected:{cells:{'t1/r1/c2':{text:'구매-2026-031'},'t1/r1/c4':{numbers:[2026,10,20]},'t1/r2/c2':{text:'총무팀'},'t1/r2/c4':{text:'정하늘'},'t1/r3/c2':{text:'회의실 의자 교체'},'t1/r4/c2':{text:'1,200,000'},'t1/r5/c2':{text:'의자'}},sections:{}}},
  {id:'weekly',form:'weekly',name:'주간 보고',request:'주간 업무 보고를 써 주세요. 보고자 한도윤, 보고 기간 2026. 10. 13. ~ 10. 17. 금주 실적: 신규 화면 설계 완료, 성능 시험 2회 진행. 차주 계획: 화면 구현 시작, 성능 개선안 정리. 특이 사항은 없음.',
    expected:{cells:{'t1/r1/c2':{text:'한도윤'},'t1/r1/c4':{numbers:[10,13]},'t2/r2/c1':{text:'화면 설계'},'t3/r2/c1':{text:'화면 구현'}},sections:{'3. 특이 사항':['없음']}}},
  {id:'trip-missing',form:'trip',name:'출장 보고 2',request:'출장 결과 보고서를 써 주세요. 출장자 이서준, 소속 기술지원팀, 출장지 광주 지사. 출장 목적은 지사 장비 교체입니다. 결과 및 향후 계획: 교체 완료, 사후 점검은 다음 달.',
    answers:{s4:'2026. 11. 3. ~ 2026. 11. 4.'},
    expected:{asks:['s4'],cells:{'t1/r2/c2':{text:'광주'},'t1/r3/c2':{numbers:[2026,11,3,2026,11,4]}},sections:{'1. 출장 목적':['교체']}}}
];

export function gradeCase(testCase,{copyItems,written,checks,asked,opened}){
  const cell=id=>copyItems.find(item=>item.id===id)?.text??'';
  const cells=Object.entries(testCase.expected.cells??{}).map(([target,want])=>{const text=cell(target);const ok=want.text?has(text,want.text):holds(text,want.numbers);return {target,ok,text:text.slice(0,120),want:want.text??want.numbers.join('.')};});
  const paragraphs=copyItems.filter(item=>item.kind==='paragraph');
  const sections=Object.entries(testCase.expected.sections??{}).map(([title,words])=>{
    const at=paragraphs.findIndex(p=>p.text.trim()===title);const next=paragraphs.findIndex((p,k)=>k>at&&/^\d+\.\s/.test(p.text.trim()));
    const body=at<0?'':paragraphs.slice(at+1,next<0?undefined:next).map(p=>p.text).join(' ');return {title,ok:at>=0&&words.every(word=>has(body,word)),body:body.slice(0,160)};
  });
  const asks=(testCase.expected.asks??[]).map(slot=>({slot,ok:asked.includes(slot)}));
  const preserved=!!written&&written.sameEntries===true&&!written.violations?.length;
  const guidesLeft=checks?.summary?/남은 안내 문구 (\d+)/.exec(checks.summary)?.[1]??null:null;
  const accuracy=[...cells,...sections].length?[...cells,...sections].filter(x=>x.ok).length/[...cells,...sections].length:1;
  return {opened,preserved,guidesLeft:guidesLeft===null?null:Number(guidesLeft),accuracy:Math.round(accuracy*1000)/1000,asksOk:asks.every(x=>x.ok),cells,sections,asks,
    success:opened!==false&&preserved&&accuracy===1&&asks.every(x=>x.ok)&&(guidesLeft===null||Number(guidesLeft)===0)};
}

const isMain=process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url;
if(isMain)await main();
async function main(){
  const option=name=>{const at=process.argv.indexOf('--'+name);return at>0?process.argv[at+1]:undefined;};
  const out=option('out')&&path.resolve(option('out')),model=option('model')||'claude-sonnet-5-5',only=option('only')?.split(',');
  if(!out){console.error('사용법: node eval/document-forms/run.mjs --out <dir> [--model claude-sonnet-5-5] [--only id,id]');process.exit(2);}
  await mkdir(out,{recursive:true});
  const {ProjectService}=await import('../../runtime/project-service.mjs');
  const {createDesktopProviders}=await import('../../runtime/desktop-providers.mjs');
  const {git}=await import('../../runtime/files.mjs');
  const {docxSnapshot}=await import('../../runtime/docx-snapshot.mjs');
  const {renderDocumentPages,findSoffice}=await import('../../runtime/document-render.mjs');
  const {docxFromBlocks,FORMS}=await import('../../tests/helpers-docx-fixture.mjs');
  const report={model,startedAt:new Date().toISOString(),soffice:await findSoffice()?'available':'missing',cases:[]};
  const providers=createDesktopProviders({hostLabel:'누비 양식 작성 점검'});
  let calls=0;
  try{
    await providers.connect({provider:'claude'});if(!providers.status().models.some(m=>m.id===model))throw Error('model_unavailable:'+model);await providers.model(model);
    report.connection={provider:providers.status().provider,model:providers.status().model};
    const complete=providers.complete.bind(providers);providers.complete=(...args)=>{calls++;return complete(...args);};
    for(const testCase of CASES.filter(c=>!only||only.includes(c.id))){
      const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-forms-eval-'))),root=path.join(dir,'repo');
      const row={id:testCase.id,success:false,error:null};report.cases.push(row);const started=Date.now(),callsBefore=calls;
      let service;
      try{
        await mkdir(path.join(root,'서식'),{recursive:true});await git(root,['init','-q']);await git(root,['config','user.email','eval@example.invalid']);await git(root,['config','user.name','Eval']);
        await writeFile(path.join(root,'README.md'),'# 양식 점검\n');await git(root,['add','.']);await git(root,['commit','-qm','init']);
        const source=path.join(root,'서식',testCase.form+'.docx');await writeFile(source,await docxFromBlocks(FORMS[testCase.form]));
        service=new ProjectService({storageRoot:path.join(dir,'state')});await service.open(root);
        // One login serves every case: a case's service must not dispose the shared connection.
        service.providers=new Proxy(providers,{get:(target,key)=>key==='dispose'?()=>{}:typeof target[key]==='function'?target[key].bind(target):target[key]});
        const projectId=service.projectId,call=args=>service.invoke('documentForm',{projectId,...args});
        await call({action:'register',source:path.relative(root,source),name:testCase.name,engine:'file',acknowledgeFileOnly:true});
        let state=await call({action:'plan',name:testCase.name,request:testCase.request});const asked=[];
        for(let turn=0;state.state==='asking'&&turn<4;turn++){const answers={};for(const q of state.questions){asked.push(q.slot);if(testCase.answers?.[q.slot])answers[q.slot]=testCase.answers[q.slot];}state=await call({action:'answer',planId:state.planId,answers});}
        row.plan={state:state.state,error:state.error,questions:asked};
        if(state.state!=='ready')throw Error('plan_'+state.state+(state.error?':'+state.error:''));
        const output=`문서/${testCase.id}.docx`;state=await call({action:'apply',planId:state.planId,output});
        for(let turn=0;['approval','asking'].includes(state.state)&&turn<4;turn++){
          if(state.state==='approval')state=await call({action:'apply',planId:state.planId,output});
          else{const answers={};for(const q of state.questions){asked.push(q.slot);answers[q.slot]=testCase.answers?.[q.slot]??'요청대로 작성해 주세요.';}state=await call({action:'answer',planId:state.planId,answers});}
        }
        if(state.state!=='written')throw Error('apply_'+state.state+(state.error?':'+state.error:''));
        const bytes=await readFile(path.join(root,output));const copyItems=(await docxSnapshot(bytes)).items;
        let opened=true;
        if(report.soffice==='available'){const render=await renderDocumentPages(path.join(root,output),{outDir:path.join(out,'renders',testCase.id),maxPages:2});opened=render.status==='rendered';row.render={status:render.status,pages:render.pages.map(p=>path.relative(out,p.path))};}
        Object.assign(row,gradeCase(testCase,{copyItems,written:state.written,checks:state.checks,asked,opened}),{checks:state.checks?.summary??null,unresolved:state.unresolved?.length??0,remaining:state.remaining?.what??null,counts:state.written?.counts??null});
        await writeFile(path.join(out,testCase.id+'.docx'),bytes);
      }catch(error){row.error=String(error?.message??error).slice(0,300);}
      finally{row.ms=Date.now()-started;row.modelCalls=calls-callsBefore;service?.dispose();service?.store?.close?.();await rm(dir,{recursive:true,force:true}).catch(()=>{});}
      console.log(JSON.stringify({id:row.id,success:row.success,accuracy:row.accuracy,preserved:row.preserved,opened:row.opened,asksOk:row.asksOk,guidesLeft:row.guidesLeft,modelCalls:row.modelCalls,ms:row.ms,error:row.error}));
    }
  }finally{providers.dispose?.();}
  const done=report.cases;
  report.summary={cases:done.length,success:done.filter(c=>c.success).length,meanAccuracy:done.length?Math.round(done.reduce((n,c)=>n+(c.accuracy??0),0)/done.length*1000)/1000:0,preserved:done.filter(c=>c.preserved).length,opened:done.filter(c=>c.opened).length,medianMs:done.map(c=>c.ms).sort((a,b)=>a-b)[Math.floor(done.length/2)]??null,modelCalls:done.reduce((n,c)=>n+(c.modelCalls??0),0)};
  report.finishedAt=new Date().toISOString();
  await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,1)+'\n');
  console.log('summary',JSON.stringify(report.summary));
}
