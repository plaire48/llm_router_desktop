import {inspectGeneratedExcel} from '../dist/excel.js';
import {inspectGeneratedPowerPoint} from '../dist/powerpoint.js';
// Fixed task answers live only in evaluation, never in the generic generators.
const counts=[['Word',3,2,1],['Excel',2,1,1],['PowerPoint',1,0,1]];
const actions=[['Word','표 서식 검토','김민수','10월 16일'],['Excel','합계 수식 검증','이지은','10월 16일'],['PowerPoint','출처 확인','박서준','10월 19일']];
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sourceLink=(formula,column,row)=>formula===`'원본'!${column}${row}`||formula===`원본!${column}${row}`;
export async function evaluateExcelCreate01(bytes){
  const read=await inspectGeneratedExcel(bytes),summary=read.sheets.find(s=>s.name==='검토 현황'),source=read.sheets.find(s=>s.name==='원본');
  const checks={sheetRoles:!!summary&&!!source&&read.sheets.length===2,sourceFacts:counts.every((row,r)=>row.every((value,c)=>source?.rows[r+1]?.[c]?.value===value)),sourceActions:actions.every((row,r)=>row.slice(1,3).every((value,c)=>source?.rows[r+1]?.[c+4]?.value===value)),sourceDeadlines:['2026-10-16','2026-10-16','2026-10-19'].every((date,r)=>source?.rows[r+1]?.[6]?.value===date),liveTotals:['B','C','D'].every((col,c)=>summary?.rows[4]?.[c+1]?.formula?.toUpperCase()===`SUM(${col}2:${col}4)`),liveRate:summary?.rows[4]?.[4]?.formula?.toUpperCase()==='IF(B5=0,0,C5/B5)',linkedInputs:counts.every((row,r)=>[1,2].every(c=>sourceLink(summary?.rows[r+1]?.[c]?.formula,c===1?'B':'C',r+2))),pendingDerivation:counts.every((_,r)=>summary?.rows[r+1]?.[3]?.formula===`B${r+2}-C${r+2}`),decision:summary?.rows[6]?.[1]?.value==='보류'&&summary?.rows[7]?.[1]?.value==='2026-10-19'&&summary?.rows[7]?.[2]?.value==='16:00',uncertainty:summary?.rows[8]?.[0]?.value==='PowerPoint 비용'&&summary?.rows[8]?.[1]?.value==='근거 확인 중',noActiveContent:!read.hasExternalRelationships&&!read.hasMacros};
  return {taskId:'EX-CREATE-01',passed:Object.values(checks).every(Boolean),checks,calculationVerified:false,officeVerified:false};
}
export async function evaluatePowerPointCreate01(bytes){
  const read=await inspectGeneratedPowerPoint(bytes),s=read.slides,text=s.flatMap(slide=>slide.texts).join('\n');
  const checks={slideCount:s.length===3,conclusionFirst:/배포.*보류/.test(s[0]?.title??''),headlineFacts:/6건.*3건/.test(s[0]?.texts.join('')??'')&&/50%/.test(s[0]?.texts.join('')??''),decisionDeadline:/10월 19일 16시/.test(s[0]?.texts.join('')??''),editableCounts:equal(s[1]?.tables[0]?.rows,[['문서 종류','작성','검토 완료','검토 대기'],...counts.map(row=>row.map(String)),['합계','6','3','3']]),editableActions:equal(s[2]?.tables[0]?.rows,[['문서 종류','남은 검토','담당자','마감일'],...actions]),uncertainty:/비용 근거.*확인 중/.test(text)&&/금액.*확정하지/.test(text),sourceNotes:s.every(slide=>/출처:/.test(slide.notes)),noActiveContent:!read.hasExternalRelationships&&!read.hasMacros};
  return {taskId:'PP-CREATE-01',passed:Object.values(checks).every(Boolean),checks,officeVerified:false};
}
