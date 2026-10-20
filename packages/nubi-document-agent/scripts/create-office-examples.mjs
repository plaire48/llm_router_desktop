import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createExcelDocument,inspectGeneratedExcel} from '../dist/excel.js';
import {createPowerPointDocument,inspectGeneratedPowerPoint} from '../dist/powerpoint.js';
const root=resolve(process.argv[2]??'artifacts/office-create-01');
const fixture=JSON.parse(await readFile(new URL('../eval/WD-CREATE-01.json',import.meta.url),'utf8'));
const cell=(value=null,role='body',format='general')=>({value,formula:null,role,format});
const formula=(formula,format='integer')=>({value:null,formula,role:'total',format});
const source=fixture.sources;
const excel={title:fixture.sources.period+' 문서 검토 현황',sheets:[
  {name:'검토 현황',columnWidths:[26,18,18,18,18],rows:[
    ['문서 종류','작성','검토 완료','검토 대기','완료율'].map(x=>cell(x,'header')),
    ...source.counts.map((count,i)=>{const n=i+2;return [cell(count.document),formula(`'원본'!B${n}`),formula(`'원본'!C${n}`),formula(`B${n}-C${n}`),formula(`IF(B${n}=0,0,C${n}/B${n})`,'percent')];}),
    [cell('합계','total'),formula('SUM(B2:B4)'),formula('SUM(C2:C4)'),formula('SUM(D2:D4)'),formula('IF(B5=0,0,C5/B5)','percent')],
    Array.from({length:5},()=>cell()),
    [cell('배포 결정','header'),cell('보류'),cell(),cell(),cell()],
    [cell('다음 배포 결정'),cell('2026-10-19','body','date'),cell('16:00'),cell(),cell()],
    [cell('PowerPoint 비용'),cell('근거 확인 중'),cell(),cell(),cell()]
  ]},
  {name:'원본',columnWidths:[20,12,14,14,26,16,18],rows:[
    ['문서 종류','작성','검토 완료','검토 대기','남은 검토','담당자','마감일'].map(x=>cell(x,'header')),
    ...source.counts.map((count,i)=>{const action=source.pendingActions[i];return [cell(count.document),cell(count.created,'input','integer'),cell(count.reviewed,'input','integer'),cell(count.pending,'input','integer'),cell(action.action),cell(action.owner),cell(i===2?'2026-10-19':'2026-10-16','input','date')];}),
    Array.from({length:7},()=>cell()),
    [cell('출처'),cell('합성 평가 자료'),cell(),cell(),cell(),cell(),cell()],
    [cell('보고 시작'),cell('2026-10-12','body','date'),cell(),cell(),cell(),cell(),cell()],
    [cell('보고 종료'),cell('2026-10-15','body','date'),cell(),cell(),cell(),cell(),cell()]
  ]}
]};
const totals=source.counts.reduce((sum,c)=>[sum[0]+c.created,sum[1]+c.reviewed,sum[2]+c.pending],[0,0,0]);
const ppt={title:'문서 작성 시범 운영 주간 보고',slides:[
  {title:'검토 대기 3건으로 배포 보류',paragraphs:['작성한 6건 중 3건의 검토를 완료했습니다. 검토 완료율은 50%입니다.','검토 대기 3건을 처리한 뒤 10월 19일 16시에 배포 여부를 다시 결정합니다.','보고 기간: 2026년 10월 12일부터 10월 15일까지'],table:null,notes:'출처: 합성 평가 WD-CREATE-01. 검토 완료율은 검토 완료 3건 / 작성 6건.'},
  {title:'문서별 작성과 검토 현황',paragraphs:[],table:{headers:['문서 종류','작성','검토 완료','검토 대기'],rows:[...source.counts.map(c=>[c.document,String(c.created),String(c.reviewed),String(c.pending)]),['합계',...totals.map(String)]]},notes:'출처: 합성 평가 WD-CREATE-01 counts. 모든 수치는 건 단위.'},
  {title:'남은 검토와 담당자',paragraphs:['PowerPoint의 비용 근거는 확인 중입니다. 금액은 확정하지 않습니다.'],table:{headers:['문서 종류','남은 검토','담당자','마감일'],rows:source.pendingActions.map(a=>[a.document,a.action,a.owner,a.due])},notes:'출처: 합성 평가 WD-CREATE-01 pendingActions, unknown. 비용 금액은 제공되지 않음.'}
]};
const fontFamily=process.platform==='darwin'?'Apple SD Gothic Neo':'Malgun Gothic';
await mkdir(join(root,'drafts'),{recursive:true});
const entries=[];
for(const [domain,draft,create,inspect,extension] of [['excel',excel,createExcelDocument,inspectGeneratedExcel,'xlsx'],['powerpoint',ppt,createPowerPointDocument,inspectGeneratedPowerPoint,'pptx']]){
  const result=await create(draft,new AbortController().signal,{fontFamily});
  const inspection=await inspect(result.bytes);
  await writeFile(join(root,'drafts',`${domain}-report.${extension}`),result.bytes,{flag:'wx'});
  await writeFile(join(root,`${domain}.reference-draft.json`),JSON.stringify(draft,null,2)+'\n',{flag:'wx'});
  entries.push({domain,engine:result.engine,sha256:createHash('sha256').update(result.bytes).digest('hex'),inspection});
}
await writeFile(join(root,'generation.json'),JSON.stringify({source:'deterministic_reference_drafts',modelMeasured:false,fontFamily,actualOffice2016:false,nascaVerified:false,entries},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({root,created:2,modelMeasured:false}));
