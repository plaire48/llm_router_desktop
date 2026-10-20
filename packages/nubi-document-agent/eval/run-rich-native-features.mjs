// Actual existing-engine calls on new synthetic drafts; never a model or Windows result.
import assert from'node:assert/strict';import{mkdir,readFile,writeFile}from'node:fs/promises';import{resolve,join}from'node:path';import{createHash}from'node:crypto';
import ExcelJS from'exceljs';import{createExcelDocument}from'../dist/excel.js';import{createGeneratedFileSession}from'../dist/file-operations.js';import{createNodeGenOfficeEngine}from'../scripts/genoffice-node-port.mjs';import{parts,find,inspectPreservation}from'./feature-wave-cases.mjs';
const root=resolve(process.argv[2]),seeds=resolve('artifacts/feature-wave-3'),slide=resolve('artifacts/hard-business-1/build/slides.cjs'),wordExcel='/Users/ganadi/Documents/office_x/dist/cli/genoffice-engine.cjs',signal=new AbortController().signal,sha=b=>createHash('sha256').update(b).digest('hex');
const engine=createNodeGenOfficeEngine({wordExcelEnginePath:wordExcel,slideEnginePath:slide});await mkdir(root,{recursive:true});
const report={kind:'real_rich_native_file_features',planned:9,actualOffice2016:false,modelMeasured:false,trials:[],sourceHashes:{},engineHashes:{wordExcel:sha(await readFile(wordExcel)),slides:sha(await readFile(slide))}};
for(const file of ['src/file-operations.ts','src/excel.ts','src/excel-formula.ts','scripts/genoffice-node-port.mjs','eval/run-rich-native-features.mjs'])report.sourceHashes[file]=sha(await readFile(new URL('../'+file,import.meta.url)));
const cell=value=>({value,formula:null,format:'general',role:'body'}),v=(x,key)=>x?.['@_'+key];
for(let n=1;n<=3;n++)for(const domain of ['word','excel','powerpoint']){
 const record={domain,repetition:n,status:'running'},dir=join(root,domain+'-'+n),ext={word:'docx',excel:'xlsx',powerpoint:'pptx'}[domain];report.trials.push(record);await mkdir(dir,{recursive:true});let session;
 try{
  let bytes;if(domain==='excel'){const values=[['region','product','amount'],['North','A',10*n],['South','B',20*n],['North','B',5*n],['West','A',7*n],...Array.from({length:3},()=>[])];bytes=(await createExcelDocument({title:'Pivot check',sheets:[{name:'Data',columnWidths:Array(8).fill(20),rows:values.map(row=>Array.from({length:8},(_,i)=>cell(row[i]??null)))}]},signal)).bytes;}
  else bytes=new Uint8Array(await readFile(join(seeds,`${domain}-${domain==='word'?'setFont':'addElement'}-${n}/source.${ext}`)));
  record.sourceHash=sha(bytes);await writeFile(join(dir,'source.'+ext),bytes);
  const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=','base64'));
  session=await createGeneratedFileSession({domain,origin:'new_unencrypted_draft',bytes,...(domain==='powerpoint'?{assets:[{id:'fixture',bytes:png,mime:'image/png',description:'Synthetic picture fixture'}]}:{})},engine);
  let state=await session.read(signal),operations=[];
  const apply=async ops=>{state=await session.apply(ops,state.revision,signal);operations.push(...ops);};
  if(domain==='word')await apply([{op:'define_style',styleId:'RichCallout',basedOn:'Normal',run:{italic:true}},{op:'applyStyle',target:{blockIndexes:[2]},styleId:'RichCallout'},{op:'setParagraphFormat',target:{blockIndexes:[2]},align:'justify',lineSpacing:1.5+n*.1,spaceBefore:240,spaceAfter:120,indentFirstLine:440},{op:'setFont',target:{blockIndexes:[2]},italic:true,color:'#3182F6'}]);
  else if(domain==='excel'){
   await apply([{op:'add_pivot',sheet:'Data',sourceRange:'A1:C5',targetCell:'E1',rowFields:'region',values:[{field:'amount',agg:'sum'}],name:'RegionSummary'}]);
   await apply([{op:'set_formula',sheet:'Data',address:'H2',formula:'VLOOKUP("North",E2:F4,2,FALSE)'}]);
  }else{
   await apply([0,1,2].map(i=>({op:'addElement',target:{slide:0},kind:'rect',offset:{x:800000+i*3000000,y:5000000,cx:1800000,cy:700000},fill:'#E8F1FE',paragraphs:[{runs:[{text:'Step '+(i+1),fontSize:16}]}]})));
   const ids=state.observation.pages[0].elements.slice(-3).map(e=>e.id);
   await apply(ids.map((el,i)=>({op:'setShapeGeometry',target:{slide:0,el},prst:['hexagon','diamond','ellipse'][i]})));
   await apply([{op:'groupElements',target:{slide:0},els:ids.slice(0,2)}]);const group=state.observation.pages[0].elements.find(e=>e.type==='group');assert.ok(group);
   await apply([{op:'addConnector',target:{slide:0},from:group.id,to:ids[2],kind:'elbow',arrow:'end',line:{color:'#3182F6',widthPt:1.5}}]);
   await apply([{op:'addPictureAsset',target:{slide:0},assetRef:'fixture',offset:{x:10000000,y:5000000,cx:700000,cy:700000}}]);
  }
  const candidate=session.snapshot().bytes;await writeFile(join(dir,'candidate.'+ext),candidate);record.candidateHash=sha(candidate);const p=await parts(candidate);
  if(domain==='word'){
   const xml=await p.xml('word/document.xml'),para=find(xml,'w:p').find(x=>JSON.stringify(x).includes('변경 대상 '+n));assert.ok(para);const spacing=find(para,'w:spacing');assert.ok(spacing.some(x=>Number(v(x,'w:line'))===Math.round((1.5+n*.1)*240)&&v(x,'w:before')==='240'&&v(x,'w:after')==='120'));assert.ok(find(para,'w:pStyle').some(x=>v(x,'w:val')==='RichCallout'));assert.ok(find(para,'w:ind').some(x=>v(x,'w:firstLine')==='440'));await inspectPreservation(domain,bytes,candidate,n,'rich-format');
  }else if(domain==='excel'){
   const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(candidate);const sheet=workbook.getWorksheet('Data');assert.equal(sheet.getCell('F2').value,15*n);assert.equal(sheet.getCell('F5').value,42*n);assert.equal(sheet.getCell('H2').formula,'VLOOKUP("North",E2:F4,2,FALSE)');
   const pivot=await p.z.file('xl/pivotTables/pivotTable1.xml').async('string');assert.ok(pivot.includes('E1:F5'));const caches=Object.keys(p.z.files).filter(x=>/pivotCacheRecords\d+\.xml$/.test(x));assert.equal(caches.length,1);assert.equal(find(await p.xml(caches[0]),'r').length,4);record.calculationStatus='VLOOKUP_requires_actual_calculation';record.expectedVlookup=15*n;
  }else{
   const xml=await p.xml('ppt/slides/slide1.xml');for(const shape of ['hexagon','diamond','ellipse'])assert.ok(find(xml,'a:prstGeom').some(x=>v(x,'prst')===shape));assert.equal(find(xml,'p:pic').length,1);assert.equal(find(xml,'p:cxnSp').length,1);assert.equal(find(xml,'p:grpSp').length,1);assert.ok(Object.keys(p.z.files).some(x=>x.startsWith('ppt/media/')));await inspectPreservation(domain,bytes,candidate,n,'rich-drawing');
  }
  assert.equal(sha(bytes),record.sourceHash);record.status='passed';record.operations=operations.map(o=>o.op);await writeFile(join(dir,'operations.json'),JSON.stringify(operations,null,2)+'\n');await writeFile(join(dir,'readback.json'),JSON.stringify(state.observation,null,2)+'\n');
 }catch(e){record.status='failed';record.error=e.code??e.message;}finally{session?.dispose();}
 await writeFile(join(root,'results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(record));
}
report.passed=report.trials.filter(x=>x.status==='passed').length;report.finishedAt=new Date().toISOString();await writeFile(join(root,'results.json'),JSON.stringify(report,null,2)+'\n');
