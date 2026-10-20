import {readFile,writeFile,mkdir} from 'node:fs/promises';import{join,resolve}from'node:path';import{spawn}from'node:child_process';import{createHash}from'node:crypto';
import JSZip from 'jszip';import{XMLParser}from'fast-xml-parser';
import{cases,oracle}from'../eval/open-composition-cases.mjs';
import{containsNumber}from'../eval/numeric-evidence.mjs';
import{inspectBusinessTables}from'../eval/business-table-oracle.mjs';
const root=resolve(process.argv[2]??'artifacts/open-composition-1');const report=JSON.parse(await readFile(join(root,'model-results.json'),'utf8')),p=new XMLParser({ignoreAttributes:false,parseTagValue:false});
const all=(node,key)=>!node||typeof node!=='object'?[]:Object.entries(node).flatMap(([k,v])=>k===key?(Array.isArray(v)?v:[v]):Array.isArray(v)?v.flatMap(n=>all(n,key)):all(v,key));
const content=node=>all(node,'w:t').concat(all(node,'a:t')).map(v=>typeof v==='object'?v['#text']??'':v).join(' ');
const checks=[];
for(const task of report.tasks){
 const c=cases.find(c=>c.id===task.case),dir=join(root,task.id),row={id:task.id,domain:task.domain,status:'not_created',checks:[]};checks.push(row);const add=(name,passed,detail)=>row.checks.push({name,passed,...(detail?{detail}:{} )});
 try{
  const plan=JSON.parse(await readFile(join(dir,'composition.json'),'utf8'));const path=join(root,task.file??task.id+'/candidate.'+{word:'docx',excel:'xlsx',powerpoint:'pptx'}[task.domain]),bytes=await readFile(path),zip=await JSZip.loadAsync(bytes);row.artifactHash=createHash('sha256').update(bytes).digest('hex');
  const texts=[],tables=[];for(const name of Object.keys(zip.files).filter(n=>/^(word\/document|ppt\/slides\/slide\d+)\.xml$/.test(n))){const xml=await zip.file(name).async('string');add('finite native geometry '+name,!/="(?:NaN|-?Infinity)"/.test(xml));const tree=p.parse(xml);texts.push(content(tree));const prefix=task.domain==='word'?'w:':'a:';for(const t of all(tree,prefix+'tbl')){const rows=all(t,prefix+'tr').map(r=>all(r,prefix+'tc').map(content));tables.push({headers:rows[0]??[],rows:rows.slice(1)});}}
  const text=texts.join('\n');await writeFile(join(dir,'actual-content.txt'),text);row.text=text;
  if(task.domain==='word'||task.domain==='powerpoint'){const arithmetic=inspectBusinessTables(c,tables);add('independent group-table arithmetic',arithmetic.passed,{checkedCells:arithmetic.checkedCells,failures:arithmetic.checks.filter(c=>!c.passed)});}
  if(task.domain==='word'){
   for(const req of c.requirements)add('business requirement '+req,text.includes(req));add('fictional disclosure',text.includes('가상'));add('native tables',Object.keys(zip.files).includes('word/document.xml')&&(await zip.file('word/document.xml').async('string')).includes('<w:tbl>'));
   add('no internal source identifiers',!/(?:datasets\.|oracle|\.unitPrice|formulaTemplate)/.test(text));
   for(const [metric,value]of Object.entries(oracle(c)))add('numeric fact '+metric,containsNumber(text,value)||(metric==='windowGap'&&value<0&&containsNumber(text,-value)&&/초과|부족/.test(text)),`${value}`);
   if(c.id==='migration')add('time overrun leads to deferral',/보류|연기|불승인/.test(text)&&/60/.test(text));
  }else if(task.domain==='powerpoint'){
   add('fictional disclosure',text.includes('가상')||plan.slides.every(s=>s.notes.includes('가상')));add('native chart',Object.keys(zip.files).some(n=>/^ppt\/charts\/chart\d+\.xml$/.test(n)));add('native editable chart workbook',Object.keys(zip.files).some(n=>/^ppt\/embeddings\/.*\.xlsx$/.test(n)));add('native table',texts.length>0&&(await Promise.all(Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).map(n=>zip.file(n).async('string')))).some(x=>x.includes('<a:tbl>')));
   if(c.id==='migration')add('time overrun leads to deferral',/보류|연기|불승인/.test(text)&&/360/.test(text)&&/300/.test(text));
   const issue=[];for(const [si,s]of plan.slides.entries())for(const [ei,e]of s.elements.entries()){
    if(e.kind==='text'){
     const widthUnits=Array.from(e.text).reduce((v,ch)=>v+(ch.charCodeAt(0)>255?1:.52),0),lineCapacity=e.w*72/e.fontSize;const lines=Math.max(e.text.split('\n').length,Math.ceil(widthUnits/Math.max(1,lineCapacity)));if(lines*e.fontSize/72*1.18>e.h+.08)issue.push({slide:si+1,element:ei,problem:'estimated_text_overflow',lines,height:e.h,text:e.text});
    }
   }add('estimated text fits its boxes',!issue.length,issue);row.layoutSummary={slides:plan.slides.length,elements:plan.slides.map(s=>s.elements.map(e=>({kind:e.kind,x:e.x,y:e.y,w:e.w,h:e.h}))),freeCoordinates:true};
  }
  row.status=row.checks.every(c=>c.passed)?'automated_checks_passed':'quality_failed';
 }catch(error){row.status='failed';row.error=error.code??error.message;}
}
await writeFile(join(root,'independent-content-checks.json'),JSON.stringify({tasks:checks,nativeOfficeVerified:false},null,2)+'\n');console.log(JSON.stringify(checks.map(r=>({id:r.id,status:r.status,failed:r.checks.filter(c=>!c.passed).map(c=>c.name),error:r.error})),null,2));
