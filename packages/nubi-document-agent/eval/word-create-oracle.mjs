import {inspectGeneratedWord} from '../dist/word.js';

// Fixed evaluation-only expectations. Never imported into the authoring engine or given as model answers.
export async function evaluateWordCreate01(bytes){
  const document=await inspectGeneratedWord(bytes),failed=[];
  const check=(id,value)=>{if(!value)failed.push(id);};
  const paragraphs=document.paragraphs.map(p=>p.runs.map(r=>r.text).join('')),text=paragraphs.join('\n');
  const normalize=value=>value.replace(/\s+/g,'');
  const rows=[['문서 종류','작성','검토 완료','검토 대기'],['Word','3','2','1'],['Excel','2','1','1'],['PowerPoint','1','0','1'],['합계','6','3','3']];
  check('title',document.title==='문서 작성 시범 운영 주간 보고');
  check('counts_and_totals',document.tables.some(table=>JSON.stringify(table.rows.map(row=>row.map(normalize)))===JSON.stringify(rows.map(row=>row.map(normalize)))));
  check('completion_rate',/(?:완료율|검토\s*완료\s*비율)\D{0,10}50\s*%/.test(text));
  check('conclusion_first',/배포.{0,15}보류/.test(paragraphs.find((p,i)=>document.paragraphs[i].styleId==='Normal'&&p.trim())??''));
  check('decision_deadline',/10월\s*19일\s*(?:16시|16:00)/.test(text)&&/검토\s*대기\s*3건/.test(text));
  const contexts=[...paragraphs.flatMap(p=>p.split(/[.!?]\s*/)),...document.tables.flatMap(t=>t.rows.map(row=>row.join(' ')))].map(normalize);
  check('pending_owners_and_dates',[
    ['김민수','Word','표','서식','10월16일'],['이지은','Excel','합계','수식','10월16일'],['박서준','PowerPoint','출처','10월19일']
  ].every(parts=>contexts.some(context=>parts.every(part=>context.includes(part)))));
  check('uncertainty_preserved',/비용/.test(text)&&/(?:확인\s*중|확정하지|미확인)/.test(text));
  check('no_invented_cost',!/(?:\d[\d,.]*\s*(?:만\s*원|억\s*원|원|USD)|\$\s*\d)/.test(text));
  check('meaningful_bold',document.paragraphs.some(p=>p.styleId==='Normal'&&p.runs.some(r=>r.bold&&/보류/.test(r.text))));
  check('editable_table',document.tables.length>=1&&document.tables.every(t=>t.repeatingHeader&&t.rowsDontSplit&&t.columnWidthsTwips.reduce((a,b)=>a+b,0)<=9026));
  check('a4',document.page.widthTwips===11906&&document.page.heightTwips===16838);
  check('no_active_content',!document.hasExternalRelationships&&!document.hasMacros&&document.fieldCount===0);
  return {taskId:'WD-CREATE-01',passed:failed.length===0,checked:12,failed,visualVerified:false,officeVerified:false,nascaVerified:false};
}
