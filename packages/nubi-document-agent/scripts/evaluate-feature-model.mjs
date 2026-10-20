import {mkdir,readFile,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';
import {createClaudeCode} from '../../nubi-desktop/runtime/claude-code.mjs';
import {createHostModelTransport} from '../dist/host-model.js';
import {prepareFileDocument} from '../dist/file-operations.js';
import {createNodeGenOfficeEngine} from './genoffice-node-port.mjs';
import {parts,find,inspectPreservation} from '../eval/feature-wave-cases.mjs';
import {inspectFlowGeometry} from '../eval/pptx-geometry-oracle.mjs';
import {hasDirectTextColor} from '../eval/word-format-oracle.mjs';
const root=resolve(process.argv[2]??'artifacts/feature-model-1'),wave=resolve(process.argv[3]??'artifacts/feature-wave-2'),source='/Users/ganadi/Documents/office_x';
const engine=createNodeGenOfficeEngine({wordExcelEnginePath:join(source,'dist/cli/genoffice-engine.cjs'),slideEnginePath:join(wave,'engine/slides.cjs')});
const provider=createClaudeCode({contextWindows:()=>Promise.resolve(new Map())}),controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
let tasks=[
 {domain:'word',seed:'setFont',request:'변경 대상 1 문단에 ReviewCallout이라는 새 문단 스타일을 정의하고 적용하세요. 스타일의 글자는 기울임과 파랑 #3182F6으로 설정하세요. 표 머리글의 배경은 옅은 파랑 #E8F1FE로 바꾸세요. 바닥글에는 기능 검토라는 글자와 실제 페이지 번호 필드를 넣으세요. 제목, 보존 문구 1 문단, 표 내용과 나머지 서식은 유지하세요.'},
 {domain:'excel',seed:'format_range',request:'데이터 시트 A2:A4 상태 입력은 완료, 진행, 보류 목록에서 선택하게 하세요. B2:B4 금액이 20보다 크면 배경을 #C6EFCE로 표시하는 조건부 서식을 넣으세요. A1:C4는 ReviewData라는 편집 가능한 표로 만드세요. 나머지 셀 값, 수식과 보존 시트는 그대로 두세요.'},
 {domain:'powerpoint',seed:'addElement',request:'첫 슬라이드의 표 아래에 요청 접수, 검토, 완료라고 적힌 둥근 사각형 3개를 추가하세요. 같은 크기와 높이로 정렬하고 좌우 간격을 균등하게 맞추세요. 첫 슬라이드의 기존 발표자 노트 보존 노트를 유지하며 담당자 검토 필요를 한 줄 추가하세요. 원본 표, 제목, 본문과 나머지 두 슬라이드 및 각 노트는 유지하세요. 한글 글꼴은 Apple SD Gothic Neo를 쓰세요. 실제 도형으로 만들어야 합니다.'}
];
const repairWord=process.argv[4]==='word-repair';
if(repairWord)tasks=tasks.filter(t=>t.domain==='word').map(t=>({...t,request:t.request+'\n표시 검증 피드백: ReviewCallout 스타일 정의와 적용은 있지만 변경 대상 1 문단의 실제 글자색이 직접 서식 000000으로 남았습니다. 해당 문구의 실제 표시색도 3182F6이 되도록 수정하세요. 이미 완료한 스타일, 표, 바닥글과 보존 문구는 유지하세요.'}));
await mkdir(root,{recursive:true});const report={kind:'live_model_feature_tasks',startedAt:new Date().toISOString(),planned:tasks.length,modelMeasured:false,actualOffice2016:false,nascaVerified:false,tasks:tasks.map(t=>({domain:t.domain,status:'not_run'})),sourceHashes:{}};
for(const file of ['src/file-operations.ts','src/operation-catalogs.json','scripts/genoffice-node-port.mjs','scripts/evaluate-feature-model.mjs'])report.sourceHashes[file]=createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex');
await writeFile(join(root,'results.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
try{
 const connected=await provider.connect();report.modelId=connected.model;report.effort=connected.reasoningEffort;
 const host={id:connected.model,async complete(messages,tools,ctx){const r=await provider.complete(messages,tools,ctx.signal,ctx.onText,()=>{},ctx.onActivity,{backgroundModel:{provider:'claude',model:ctx.modelId},typedToolArguments:true});const resolved=provider.status().models.find(m=>m.id===ctx.modelId)?.resolvedModel;if(resolved!==ctx.modelId)throw Error('invalid_model');return r;}};
 for(const [i,task]of tasks.entries()){
  const row=report.tasks[i],ext={word:'docx',excel:'xlsx',powerpoint:'pptx'}[task.domain],dir=join(root,task.domain);await mkdir(dir,{recursive:true});
  const bytes=new Uint8Array(await readFile(repairWord?join(root,'../feature-model-1/word/candidate.docx'):join(wave,`${task.domain}-${task.seed}-1/source.${ext}`)));row.status='running';row.tools=[];row.metrics=[];await writeFile(join(root,'results.json'),JSON.stringify(report,null,2)+'\n');
  const transport=createHostModelTransport(host,{onMetric:e=>{row.metrics.push(e);if(e.kind==='model_end')console.log(JSON.stringify({domain:task.domain,...e}));}});
  try{
   const result=await prepareFileDocument({domain:task.domain,origin:'new_unencrypted_draft',bytes,request:task.request},engine,transport,controller.signal,{onTool:name=>row.tools.push(name)});
   row.artifact=task.domain+'/candidate.'+ext;await writeFile(join(root,row.artifact),result.bytes);const p=await parts(result.bytes),checks={};
   if(task.domain==='word'){
    const document=await p.xml('word/document.xml'),styles=await p.xml('word/styles.xml');checks.customStyle=find(styles,'w:style').some(s=>s['@_w:styleId']==='ReviewCallout'&&JSON.stringify(s).includes('3182F6')&&find(s,'w:i').length>0);checks.appliedStyle=find(document,'w:pStyle').some(s=>s['@_w:val']==='ReviewCallout');checks.tableFill=find(document,'w:tbl').some(t=>find(t,'w:shd').some(s=>s['@_w:fill']==='E8F1FE'));const footers=Object.keys(p.z.files).filter(k=>/^word\/footer\d+\.xml$/.test(k));checks.footerPage=(await Promise.all(footers.map(k=>p.z.file(k).async('string')))).some(s=>s.includes('PAGE')&&s.includes('기능 검토'));
    checks.displayColor=hasDirectTextColor(document,'변경 대상 1','3182F6');
   }else if(task.domain==='excel'){
    const sheet=await p.z.file('xl/worksheets/sheet1.xml').async('string');checks.validation=sheet.includes('dataValidation')&&sheet.includes('완료')&&sheet.includes('진행')&&sheet.includes('보류');checks.conditionalFormat=sheet.includes('conditionalFormatting')&&sheet.includes('greaterThan')&&sheet.includes('<formula>20</formula>');checks.nativeTable=(await Promise.all(Object.keys(p.z.files).filter(k=>/^xl\/tables\/table\d+\.xml$/.test(k)).map(k=>p.z.file(k).async('string')))).some(s=>s.includes('ReviewData')&&s.includes('A1:C4'));
   }else{
    const x=await p.xml('ppt/slides/slide1.xml');Object.assign(checks,inspectFlowGeometry(x,['요청 접수','검토','완료']));const notes=await p.z.file('ppt/notesSlides/notesSlide1.xml').async('string');checks.notes=notes.includes('보존 노트')&&notes.includes('담당자 검토 필요');
   }
   try{await inspectPreservation(task.domain,bytes,result.bytes,1,task.domain==='powerpoint'?'setNotes':'model');checks.nonTargetPreservation=true;}catch{checks.nonTargetPreservation=false;}
   row.checks=checks;row.status=Object.values(checks).every(Boolean)?'passed':'quality_failed';row.appliedBatches=result.appliedBatches;
  }catch(error){row.status='failed';row.error=error.code??(/^[a-z_]{3,80}$/.test(error.message??'')?error.message:'model_task_failed');}
  await writeFile(join(root,'results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({domain:task.domain,status:row.status,error:row.error,checks:row.checks}));
 }
 report.modelMeasured=report.tasks.some(t=>t.metrics?.some(m=>m.kind==='model_end'&&!m.error));
}catch(error){report.blocked=/^[a-z_]{3,80}$/.test(error.message??'')?error.message:'host_connection_failed';}
finally{provider.disconnect();report.finishedAt=new Date().toISOString();report.passed=report.tasks.filter(t=>t.status==='passed').length;await writeFile(join(root,'results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({finished:true,passed:report.passed,planned:report.planned,blocked:report.blocked}));}
