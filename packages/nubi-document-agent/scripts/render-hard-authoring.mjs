/** Evaluation renderer: reuses Nubi's ExcelJS writer and GenOffice generators/atomic file engines. */
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import JSZip from 'jszip';
import {XMLParser} from 'fast-xml-parser';
import {createWordDocument} from '../dist/word.js';
import {createExcelDocument,bindGeneratedExcelChart} from '../dist/excel.js';
import {createPowerPointDocument,attachGeneratedPowerPointChartWorkbooks} from '../dist/powerpoint.js';
import {createGeneratedFileSession} from '../dist/file-operations.js';
import {createNodeGenOfficeEngine} from './genoffice-node-port.mjs';
import {sources,expected,departments} from '../eval/hard-business-case.mjs';
const root=resolve(process.argv[2]??'artifacts/hard-business-1'),which=process.argv[3];await mkdir(join(root,'candidates'),{recursive:true});
const signal=new AbortController().signal,font='Apple SD Gothic Neo',summary=expected();
const engine=createNodeGenOfficeEngine({wordExcelEnginePath:'/Users/ganadi/Documents/office_x/dist/cli/genoffice-engine.cjs',slideEnginePath:join(root,'build/slides.cjs')});
const json=async name=>JSON.parse(await readFile(join(root,name),'utf8'));
async function session(domain,bytes){const s=await createGeneratedFileSession({domain,origin:'new_unencrypted_draft',bytes},engine);await s.read(signal);return s;}
async function apply(s,ops){for(let i=0;i<ops.length;i+=75){try{await s.apply(ops.slice(i,i+75),s.snapshot().revision,signal);}catch(error){await writeFile(join(root,`${s.domain}-failed-batch-${Date.now()}.json`),JSON.stringify({ops:ops.slice(i,i+75),error:error.message},null,2));await writeFile(join(root,`${s.domain}-failed-source.${{word:'docx',excel:'xlsx',powerpoint:'pptx'}[s.domain]}`),s.snapshot().bytes);throw error;}}}
const cell=(value,role='body',format='general')=>({value,formula:null,format,role});
const formula=(text,format='decimal')=>({value:null,formula:text,format,role:'total'});
const execute=promisify(execFile),runtime='/Users/ganadi/.cache/codex-runtimes/codex-primary-runtime/dependencies';
async function recalculate(bytes){const dir=await mkdtemp('/private/tmp/nubi-hard-precalculate-');try{await mkdir(join(dir,'out'));await writeFile(join(dir,'base.xlsx'),bytes);await execute(join(runtime,'bin/override/soffice'),['-env:UserInstallation='+pathToFileURL(join(dir,'profile')).href,'--headless','--convert-to','xlsx','--outdir',join(dir,'out'),join(dir,'base.xlsx')],{timeout:60000});return new Uint8Array(await readFile(join(dir,'out/base.xlsx')));}finally{await rm(dir,{recursive:true,force:true});}}
if(!which||which==='excel'){
 const f=(await json('excel-draft.json')).formulas,at=(key,r)=>f[key].replaceAll('{r}',String(r));
 const sh=(name,widths,headers,rows)=>({name,columnWidths:widths,rows:[headers.map(x=>cell(x,'header')),...rows]});
 const sheets=[sh('案内',[25,65],['利用ガイド','説明'],[])];sheets[0].name='안내';sheets[0].rows=[['사내 업무 시스템 도입','2027년 연간 집행 관리'].map(v=>cell(v,'title')),['자료 구분','가상 사례이며 실제 회사 실적이 아닙니다'],['단위','모든 금액은 만원, VAT와 예비비 각 10%'],['수정할 곳','가정 월단가 및 비율, 인력 투입MM, 지출 수량 단가 상태'],['계산 흐름','가정 → 인력 및 지출 → 월별실적 및 부서집계 → 대시보드'],['비교 기준','승인한도 18000만원, 월별예산은 부서당 월375만원'],['보류 처리','보류된 지출은 원천에 유지하며 인정금액은 0'],['확인 방법','월별 합계와 부서별 합계는 대시보드 세전합계와 일치해야 합니다']].map((r,i)=>i?r.map(v=>cell(v)):r);
 sheets.push(sh('가정',[22,22],['부서 및 가정','월단가 및 값'],[...sources.rates.map(r=>[cell(r.department),cell(r.monthlyRate,'input','integer')]),[cell('VAT율'),cell(.1,'input','percent')],[cell('예비비율'),cell(.1,'input','percent')],[cell('승인한도'),cell(18000,'input','integer')]]));
 sheets.push(sh('인력',[12,16,16,18,20],['월','부서','투입MM','월단가 만원','인건비 만원'],sources.staffing.map((r,i)=>[cell(r.month),cell(r.department),cell(r.effort,'input'),formula(at('laborRate',i+2)),formula(at('laborCost',i+2))])));
 sheets.push(sh('지출',[14,10,12,16,12,18,12,20,20],['ID','월','부서','구분','수량','단가 만원','상태','인정금액 만원','상태 적용 전 금액'],sources.expenses.map((r,i)=>[cell(r.id),cell(r.month),cell(r.department),cell(r.category),cell(r.quantity,'input'),cell(r.unitPrice,'input','integer'),cell(r.status,'input'),formula(at('expenseRecognized',i+2)),formula(at('expenseAmount',i+2))])));
 sheets.push(sh('월별예산',[16,...Array(12).fill(12),18],['부서',...Array.from({length:12},(_,i)=>`${i+1}월`),'연간 만원'],[...departments.map((d,i)=>[cell(d),...Array.from({length:12},()=>cell(375,'input','integer')),formula(`SUM(B${i+2}:M${i+2})`)]),[cell('합계','total'),...Array.from({length:13},(_,i)=>formula(`SUM(${String.fromCharCode(66+i)}2:${String.fromCharCode(66+i)}5)`))]]));
 sheets.push(sh('월별실적',[12,18,18,18,18,16,18,18,18],['월','인건비 만원','집행비 만원','합계 만원','누계 만원','연간 비중','예산 만원','예산 잔액','예산 사용률'],summary.monthly.map((r,i)=>[cell(r.month),...['monthLabor','monthExpense','monthTotal','monthCumulative','monthShare'].map(k=>formula(at(k,i+2),k==='monthShare'?'percent':'decimal')),formula(`SUM('월별예산'!${String.fromCharCode(66+i)}2:${String.fromCharCode(66+i)}5)`),formula(`G${i+2}-D${i+2}`),formula(`IFERROR(D${i+2}/G${i+2},0)`,'percent')])));
 sheets.push(sh('부서집계',[16,22,22,22,20],['부서','인건비 만원','집행비 만원','합계 만원','확정건수'],departments.map((d,i)=>[cell(d),...['departmentLabor','departmentExpense','departmentTotal','departmentCount'].map(k=>formula(at(k,i+2)))])));
 sheets.push(sh('대시보드',[30,26],['연간 집행 요약','금액 만원'],[
 [cell('인건비'),formula("SUM('인력'!E2:E49)")],[cell('집행비'),formula("SUM('지출'!H2:H97)")],[cell('세전합계'),formula('SUM(B2:B3)')],...['vat','reserve','grandTotal'].map((k,i)=>[cell(['VAT','예비비','총액'][i]),formula(at(k,i+5))]),[cell('승인한도'),formula("'가정'!B8")],[cell('잔액'),formula(at('remaining',9))],[cell('확정건수'),formula('COUNTIFS(\'지출\'!G2:G97,"확정")')],[cell('보류건수'),formula('COUNTIFS(\'지출\'!G2:G97,"보류")')],[cell('집행률'),formula(at('executionRate',12),'percent')]]));
 // Show the decision view first; quoted formulas retain sheet identity after ordering.
 const draft={title:sources.project,sheets:[sheets[7],...sheets.slice(0,7)]};await writeFile(join(root,'excel-expanded-draft.json'),JSON.stringify(draft,null,2));
 const base=await createExcelDocument(draft,signal,{fontFamily:font});await writeFile(join(root,'excel-base.xlsx'),base.bytes);
 const calculated=await recalculate(base.bytes);await writeFile(join(root,'excel-precalculated.xlsx'),calculated);const s=await session('excel',calculated);
 try{await apply(s,[{op:'set_data_validation',sheet:'지출',range:'G2:G97',validation:{kind:'list',values:['확정','보류']}},{op:'add_conditional_format',sheet:'대시보드',range:'B9',rule:{kind:'number',operator:'lessThan',value:0,format:{fillColor:'#FCE8E6'}}},{op:'add_table',sheet:'지출',range:'A1:I97',name:'ExpenseLedger',style:'TableStyleMedium9'},{op:'add_chart',sheet:'월별실적',chartType:'column',dataRange:'A1:C13',anchorCell:'A17',title:'월별 집행 구성 만원'}]);
  const bound=await bindGeneratedExcelChart(await recalculate(s.snapshot().bytes),{chartPart:'xl/charts/chart1.xml',sheet:'월별실적',categoryRange:'A2:A13',series:[{name:'인건비',range:'B2:B13'},{name:'집행비',range:'C2:C13'}]},signal);
  const z=await JSZip.loadAsync(bound);const workbook=await z.file('xl/workbook.xml').async('string');z.file('xl/workbook.xml',workbook.replace(/(<definedName[^>]*name="_xlnm.Print_Area"[^>]*localSheetId="6"[^>]*>)[\s\S]*?(<\/definedName>)/,'$1\'월별실적\'!$A$1:$I$35$2'));
  await writeFile(join(root,'candidates/annual-budget.xlsx'),await z.generateAsync({type:'uint8array',compression:'DEFLATE'}));
  await execute(join(runtime,'python/bin/python3'),['scripts/fix-hard-workbook-print.py',join(root,'candidates/annual-budget.xlsx')]);
 }finally{s.dispose();}
 console.log(JSON.stringify({domain:'excel',rendered:true,formulas:draft.sheets.flatMap(s=>s.rows.flat()).filter(c=>c.formula).length}));
}
if(!which||which==='word'){
 const draft=await json(process.argv.includes('--repaired')?'word-draft-repaired.json':'word-draft.json');const first=draft.sections[0].table;first.rows.unshift(first.headers);first.headers=['결재 및 검토 기록',' ',' ',' '];
 const base=await createWordDocument(draft,signal,{fontFamily:font});const s=await session('word',base.bytes);
 try{
  const observation=(await s.read(signal)).observation;await writeFile(join(root,'word-initial-readback.json'),JSON.stringify(observation,null,2));
  const blocks=observation.blocks??observation.document?.blocks;if(!Array.isArray(blocks))throw Error('word_blocks_missing');
  const text=b=>b.text??b.preview??'';const heads=draft.sections.map(sec=>blocks.find(b=>text(b).includes(sec.heading)));if(heads.some(b=>!b))throw Error('word_heading_missing');
  const index=b=>b.index??b.blockIndex;const tables=blocks.filter(b=>b.type==='table'||b.nodeType==='table');
  const ops=heads.slice(1).map(b=>({op:'insert_section_break',afterBlockIndex:index(b)-1,type:'nextPage'})).reverse();
  await apply(s,ops);
  const current=(await s.read(signal)).observation.blocks,firstTable=current.find(b=>b.type==='table'||b.nodeType==='table');
  await apply(s,[{op:'set_header_footer',kind:'header',text:'사내 업무 시스템 도입 계획  |  가상 사례'},{op:'set_header_footer',kind:'footer',text:'검토용  |  {PAGE} / {NUMPAGES}'},{op:'set_page_setup',paper:'A4',margins:{top:'2cm',bottom:'2cm',left:'2cm',right:'2cm'}},{op:'set_page_setup',section:5,orientation:'landscape'},{op:'mergeTableCells',target:{blockIndexes:[index(firstTable)]},range:{row:0,col:0,rowEnd:0,colEnd:3}}]);
  await writeFile(join(root,'word-engine-candidate.docx'),s.snapshot().bytes);
  await execute(join(runtime,'python/bin/python3'),['scripts/stabilize-hard-word.py',join(root,'word-engine-candidate.docx'),join(root,'candidates/implementation-form.docx')]);
 }finally{s.dispose();}
 console.log(JSON.stringify({domain:'word',rendered:true}));
}
if(!which||which==='powerpoint'){
 const draft=await json('powerpoint-draft.json');const compare={headers:['대안','기간','위험','판단'],rows:sources.options.map(o=>[o.name,o.duration,o.risk,o.choice?'제안':'보류'])};
 const base=await createPowerPointDocument({title:draft.title,slides:draft.slides.map(sl=>({title:sl.title,paragraphs:sl.layout==='comparison'?[]:['초안'],table:sl.layout==='comparison'?compare:null,notes:sl.notes}))},signal,{fontFamily:font});
 await writeFile(join(root,'powerpoint-base.pptx'),base.bytes);
 const s=await session('powerpoint',base.bytes),U=n=>Math.round(n*914400),frame=(x,y,w,h)=>({x:U(x),y:U(y),cx:U(w),cy:U(h)});
 const box=(slide,text,x,y,w,h,size=22,bold=false,color='#191F28')=>({op:'addElement',target:{slide},kind:'textbox',offset:frame(x,y,w,h),paragraphs:[{runs:[{text,fontSize:size,fontFamily:font,bold,color}]}],bodyPr:{wrap:'square',anchor:'t',insetsEmu:{l:0,r:0,t:0,b:0}}});
 try{
  const ob=(await s.read(signal)).observation;await writeFile(join(root,'ppt-initial-readback.json'),JSON.stringify(ob,null,2));let ops=[];
  for(const [i,sl]of draft.slides.entries()){
   const page=ob.pages[i],table=page.elements.find(e=>e.type==='table'||e.kind==='table');
   for(const el of page.elements)if(el!==table)ops.push({op:'deleteElement',target:{slide:i,el:el.id}});
   const cover=sl.layout==='cover',dark=cover||sl.layout==='decision';
   ops.push({op:'setBackground',target:{slide:i},kind:'solid',color:dark?'#142C48':'#FFFFFF'});
   ops.push(box(i,sl.title,.65,cover?1.05:.48,12,.9,cover?40:30,true,dark?'#FFFFFF':'#191F28'));
   ops.push(box(i,sl.lead,.68,cover?2.4:1.5,11.9,cover?1.3:.8,cover?25:22,false,dark?'#E8F1FE':'#4E5968'));
   if(sl.layout==='comparison'){
    if(!table)throw Error('native_table_missing');ops.push({op:'setTransform',target:{slide:i,el:table.id},box:frame(.7,2.75,11.9,2.4)},{op:'setTableStyle',target:{slide:i,el:table.id},styleName:'zebraBlue'},{op:'setFont',target:{slide:i,el:table.id},font:{fontFamily:font,fontSizePt:20}});
   }else if(sl.layout.endsWith('_chart')){
    const monthly=sl.layout==='budget_chart';ops.push({op:'addChart',target:{slide:i},kind:monthly?'bar':'bar',categories:monthly?summary.monthly.map(x=>`${x.month}월`):summary.department.map(x=>x.name),series:monthly?[{name:'인건비',values:summary.monthly.map(x=>x.labor)},{name:'집행비',values:summary.monthly.map(x=>x.expense)}]:[{name:'세전 집행비',values:summary.department.map(x=>x.total)}],offset:frame(.8,2.65,8.6,3.65),colorScheme:['#3182F6','#72B8B5'],dataSource:'sample',title:'금액 단위 만원'});
    sl.items.slice(0,2).forEach((item,j)=>{ops.push(box(i,item.heading,9.65,2.85+j*1.55,2.8,.55,21,true),box(i,item.text,9.65,3.4+j*1.55,2.8,1,17));});
   }else if(sl.layout==='kpi'){
    const values=[['총액',summary.total],['승인한도',sources.approvalLimit],['잔액',summary.remaining]];
    values.forEach(([label,value],j)=>ops.push(box(i,label,.8+j*4.15,2.9,3.7,.5,22),box(i,value.toLocaleString('en-US')+' 만원',.8+j*4.15,3.6,3.7,.8,32,true,'#1B64DA')));
    ops.push(box(i,'VAT와 예비비를 각각 세전 합계의 10%로 반영했습니다',.8,5.3,11.7,.7,20));
   }else if(sl.layout==='roadmap'){
    sources.milestones.forEach(([label,value],j)=>{ops.push(box(i,label,.8+j*3.1,2.9,2.8,.6,27,true,'#1B64DA'),box(i,value,.8+j*3.1,3.8,2.8,1.2,22));});
    ops.push(box(i,'4월 시범 운영 → 7월 전체 전환 → 12월 인수인계',.8,5.5,11.7,.8,24,true));
   }else{
    const items=sl.items.slice(0,3),w=(11.8-(items.length-1)*.45)/items.length;
    items.forEach((item,j)=>{const x=.75+j*(w+.45);ops.push(box(i,item.heading,x,cover?4.5:3,w,.65,23,true,dark?'#B9D7FF':'#1B64DA'),box(i,item.text,x,cover?5.25:3.85,w,cover?1.25:2.25,20,false,dark?'#FFFFFF':'#191F28'));});
   }
   ops.push(box(i,`가상 사례  |  ${i+1} / 12`,.7,7.04,11.8,.25,10,false,dark?'#B9C8D9':'#8B95A1'));
  }
  await apply(s,ops);await writeFile(join(root,'ppt-engine-candidate.pptx'),s.snapshot().bytes);await writeFile(join(root,'candidates/decision-proposal.pptx'),await attachGeneratedPowerPointChartWorkbooks(s.snapshot().bytes,signal,{fontFamily:font}));await writeFile(join(root,'ppt-layout-operations.json'),JSON.stringify(ops,null,2));
 }finally{s.dispose();}
 console.log(JSON.stringify({domain:'powerpoint',rendered:true}));
}
