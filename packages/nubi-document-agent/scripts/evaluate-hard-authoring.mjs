import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createClaudeCode} from '../../nubi-desktop/runtime/claude-code.mjs';
import {createHostModelTransport} from '../dist/host-model.js';
import {prepareWordDocument} from '../dist/word.js';
import {sources,expected,contract} from '../eval/hard-business-case.mjs';
const root=resolve(process.argv[2]??'artifacts/hard-business-1');await mkdir(root,{recursive:true});
const {planDraft}=await import(pathToFileURL(join(root,'build/planner.mjs')));
await writeFile(join(root,'contract.json'),JSON.stringify(contract,null,2)+'\n',{flag:'wx'});
await writeFile(join(root,'sources.json'),JSON.stringify({...sources,summary:expected()},null,2)+'\n');
const report={contract:contract.id,startedAt:new Date().toISOString(),tasks:[],nativeOfficeVerified:false,nascaVerified:false,sourceHashes:{}};
for(const p of ['scripts/evaluate-hard-authoring.mjs','eval/hard-business-case.mjs','src/excel.ts','src/file-operations.ts'])report.sourceHashes[p]=createHash('sha256').update(await readFile(new URL('../'+p,import.meta.url))).digest('hex');
const provider=createClaudeCode({contextWindows:()=>Promise.resolve(new Map())}),controller=new AbortController();process.once('SIGINT',()=>controller.abort());
const save=()=>writeFile(join(root,'model-results.json'),JSON.stringify(report,null,2)+'\n');
try{
 const connected=await provider.connect();report.model=connected.model;report.effort=connected.reasoningEffort;
 const host={id:connected.model,async complete(messages,tools,ctx){return provider.complete(messages,tools,ctx.signal,ctx.onText,()=>{},ctx.onActivity,{backgroundModel:{provider:'claude',model:ctx.modelId},typedToolArguments:true});}};
 for(const domain of ['word','excel','powerpoint']){
  const row={domain,status:'running',metrics:[]};report.tasks.push(row);await save();
  const transport=createHostModelTransport(host,{onMetric:m=>{row.metrics.push(m);if(m.kind==='model_end')console.log(JSON.stringify({domain,...m}));}});
  try{
   const input={sources:JSON.parse(await readFile(join(root,'sources.json'),'utf8'))};let draft;
   if(domain==='word'){
    input.request='한국어 실제 업무용 사내 업무 시스템 도입 실행계획 및 결재 양식을 작성하세요. 명시적으로 가상 사례라고 표시. 정확히 8개 구역: 1 도입 승인과 결재(4열 4행 이상 결재표), 2 범위와 요구사항(6개 요구사항 추적표), 3 대안 비교(비교표), 4 연간 예산(인건비 집행비 VAT 예비비 총액 승인한도와 잔액을 구분한 표), 5 일정과 책임(분기별 이정표 담당과 검수조건), 6 위험과 대응(8열 가로형 위험대장, 위험 4개 이상), 7 검수와 인수인계(수치 기준과 증빙 표), 8 변경 신청(신청 사유 영향 검토 승인 기록 양식). 각 구역에 2개 이상 충실한 문단과 1개 편집 가능한 표를 두세요. 단순 목차나 테스트 설명이 아닌 승인 담당자가 실제로 검토할 문서. 모든 구역은 별도 페이지로 편집할 예정. 분량은 구역당 1페이지 안팎. 예산은 sources.summary를 정확히 사용하고 단위는 만원. 절감 효과나 미제공 실적은 만들어내지 마세요. 제목과 각 구역 heading은 짧고 마침표 없이. 표의 빈 작성 칸은 작성 필요로 표시하세요.';
    const result=await prepareWordDocument(input,transport,controller.signal,{fontFamily:'Apple SD Gothic Neo'});draft=result.draft;
    await writeFile(join(root,'word-base.docx'),result.bytes);
   }else if(domain==='excel'){
    const names=['laborRate','laborCost','expenseAmount','expenseRecognized','monthLabor','monthExpense','monthTotal','monthCumulative','monthShare','departmentLabor','departmentExpense','departmentTotal','departmentCount','vat','reserve','grandTotal','remaining','executionRate'];
    const schema={type:'object',additionalProperties:false,required:['formulas'],properties:{formulas:{type:'object',additionalProperties:false,required:names,properties:Object.fromEntries(names.map(n=>[n,{type:'string',maxLength:240}]))}}};
    input.request=`8시트 연간 집행 관리 문서의 실제 Excel 수식을 설계하세요. = 없이 {r}만 현재 행 번호로 대체하는 템플릿을 제출. 내부 시트 참조는 항상 작은따옴표 사용. 허용 함수 SUM IF COUNTIFS SUMIFS ROUND IFERROR VLOOKUP INDEX MATCH DATE TEXT. SUMIFS와 COUNTIFS를 사용하고 0으로 나누기 방지. 시트 구조 고정: 안내. 가정 A1:B8: A1 부서 B1 월단가, A2:B5 기술180 운영160 보안200 교육120, B6 VAT율0.1 B7 예비비율0.1 B8 승인한도18000. 인력 A1:E49: 월 부서 투입MM 월단가 인건비. 인력 D{r}=laborRate(가정 조회), E{r}=laborCost(투입MM 곱하기 단가 소수2자리). 지출 A1:H97: ID 월 부서 구분 수량 단가 상태 인정금액. expenseAmount는 수량곱하기단가 식; expenseRecognized는 확정 상태만 인정하는 최종 H열 식. 월별실적 A1:F13: 월 인건비 집행비 합계 누계 비중, B=monthLabor C=monthExpense D=monthTotal E=monthCumulative F=monthShare. 부서집계 A1:E5: 부서 인건비 집행비 합계 확정건수, B=departmentLabor C=departmentExpense D=departmentTotal E=departmentCount. 월별예산 A1:N6: 부서 1..12월 합계, 각 부서 월 예산은 고정 원천 입력으로 제공됨. 대시보드 A1:B12: B2 인건비 B3 집행비 B4 세전합계 B5 VAT B6 예비비 B7 총액 B8 승인한도 B9 잔액 B10 확정건수 B11 보류건수 B12 집행률. vat/reserve는 B4*가정비율 소수2자리. grandTotal은 B4:B6 합계. remaining은 B8-B7. executionRate는 총액/승인한도 0방지. monthShare는 D{r}/SUM(D2:D13). Cumulative E{r}는 SUM($D$2:D{r}). 부서집계와 월별실적은 인력과 지출을 SUMIFS로 연결. 실제 금액을 하드코딩하지 마세요.`;
    draft=await planDraft('excel',input,transport,controller.signal,schema,x=>{if(!x?.formulas||names.some(n=>typeof x.formulas[n]!=='string'))throw Error('invalid');},'Return formulas only, never code or external links. Preserve the supplied cell layout.');
   }else{
    const item={type:'object',additionalProperties:false,required:['heading','text'],properties:{heading:{type:'string',maxLength:24},text:{type:'string',maxLength:120}}};
    const schema={type:'object',additionalProperties:false,required:['title','slides'],properties:{title:{type:'string'},slides:{type:'array',minItems:12,maxItems:12,items:{type:'object',additionalProperties:false,required:['title','layout','lead','items','notes'],properties:{title:{type:'string',maxLength:28},layout:{type:'string',enum:['cover','columns','kpi','budget_chart','department_chart','comparison','roadmap','decision']},lead:{type:'string',maxLength:85},items:{type:'array',minItems:1,maxItems:4,items:item},notes:{type:'string',minLength:60,maxLength:1000}}}}}};
    input.request='경영진이 실제 회의에서 볼 사내 업무 시스템 도입 승인 제안서를 정확히 12장으로 작성하세요. 청중은 예산 승인권자, 발표 시간 12분. 첫장은 cover, 나머지는 문제와 범위, 대안 비교 comparison 1장, 총액과 예산 구조, 월별 비용 budget_chart 1장, 부서별 비용 department_chart 1장, 실행 roadmap 1장, 검수 기준, 위험 대응, 운영 정착, 마지막 decision의 흐름을 자연스럽게 구성하세요. layout은 최소 5종. 각 제목은 해당 장의 메시지가 드러나는 짧은 문장. 같은 요약 문구 반복 금지. 단위 만원. sources.summary 총액 VAT 예비비 잔액, 사용자240명 시범4월 전체7월 승인2026-12-18을 정확히 전달. 모델은 제목, 논리, 내용과 배치를 선택하고 렌더러는 선택된 레이아웃에 실제 차트/표/텍스트를 만듭니다. 없는 절감률 ROI 성공확률을 꾸며내지 말 것. 불확실성, 중단조건, 결재 요청을 구체적으로. 모든 발표 노트는 가상 사례 출처와 설명, 다음 장 연결을 포함. items는 columns 등 최대3개 권장. 각 항목 제목과 본문은 실제 발표에 적합한 내용.';
    draft=await planDraft('powerpoint',input,transport,controller.signal,schema,x=>{if(x?.slides?.length!==12||new Set(x.slides.map(s=>s.layout)).size<5||!['budget_chart','department_chart','comparison','roadmap','decision'].every(k=>x.slides.some(s=>s.layout===k)))throw Error('invalid');},'Use only supplied synthetic business facts. Compose a coherent decision-oriented narrative with meaningful varied layouts.');
   }
   await writeFile(join(root,domain+'-draft.json'),JSON.stringify(draft,null,2)+'\n');row.status='draft_prepared';
  }catch(e){row.status='failed';row.error=e.code??'hard_draft_failed';}
  await save();console.log(JSON.stringify({domain,status:row.status}));
 }
}finally{provider.disconnect();report.finishedAt=new Date().toISOString();await save();}
