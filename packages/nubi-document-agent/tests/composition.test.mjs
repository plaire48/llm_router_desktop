import test from 'node:test';import assert from 'node:assert/strict';import {existsSync} from 'node:fs';import JSZip from 'jszip';
import{createHostModelTransport}from'../dist/host-model.js';
const api=existsSync(new URL('../dist/composition.js',import.meta.url))?await import('../dist/composition.js'):{};
test('Word composition preserves arbitrary block order and actual section geometry',async()=>{
 assert.equal(typeof api.composeWord,'function');
 const plan={title:'검수 기록',header:'가상 사례',footer:'검토 {PAGE} / {NUMPAGES}',blocks:[{kind:'paragraph',style:'title',text:'검수 기록'},{kind:'table',widths:[3,7],headers:['항목','조건'],rows:[['A','완료']]},{kind:'paragraph',style:'heading2',text:'추가 확인'},{kind:'section',orientation:'landscape'},{kind:'table',widths:[4,4,4],headers:['담당','사실','조치'],rows:[['운영','미확정','재확인']]}]};
 const result=await api.composeWord(plan,new AbortController().signal,{fontFamily:'Apple SD Gothic Neo'}),z=await JSZip.loadAsync(result.bytes),xml=await z.file('word/document.xml').async('string');
 assert.ok(xml.indexOf('검수 기록')<xml.indexOf('항목'));assert.ok(xml.indexOf('조건')<xml.indexOf('추가 확인'));assert.equal((xml.match(/<w:tbl>/g)||[]).length,2);assert.match(xml,/w:orient="landscape"/);assert.match(await z.file('word/footer1.xml').async('string'),/PAGE/);
});
test('Excel composition lets the model choose sheet identities, table anchors and formula positions',async()=>{
 assert.equal(typeof api.expandExcelComposition,'function');
 const plan={title:'Settlement',sheets:[{name:'원장',widths:[12,20,20],tables:[{row:4,col:1,dataset:'items',columns:[{header:'부서',field:'team'},{header:'금액',field:'amount'},{header:'인정',formula:'IF(B{row}>0,B{row},0)',format:'decimal'}]}]},{name:'보고',widths:[30,22],cells:[{address:'A2',value:'합계'},{address:'B2',formula:"SUM('원장'!C5:C6)",format:'decimal'}]}],outputs:[{metric:'total',sheet:'보고',cell:'B2'}]};
 const draft=api.expandExcelComposition(plan,{items:[{team:'A',amount:15},{team:'B',amount:7}]});assert.equal(draft.sheets[0].rows[4][2].formula,'IF(B5>0,B5,0)');assert.equal(draft.sheets[1].rows[1][1].formula,"SUM('원장'!C5:C6)");
 const result=await api.composeExcel(plan,{items:[{team:'A',amount:15},{team:'B',amount:7}]},new AbortController().signal);assert.ok(result.bytes.length>5000);
 const bad=structuredClone(plan);bad.sheets[0].cells=[{address:'B5',value:999}];assert.throws(()=>api.expandExcelComposition(bad,{items:[{team:'A',amount:15}]}),/composition_cell_overlap/);
});
test('PowerPoint accepts free positions and rejects invalid geometry or executable payloads',()=>{
 assert.equal(typeof api.validateComposition,'function');
 const plan={title:'Choice',slides:[{notes:'가상 입력 기반 의사결정',background:'#FFFFFF',elements:[{kind:'text',x:.8,y:.6,w:10,h:1,text:'사용자가 결정할 내용',fontSize:32,color:'#191F28',bold:true},{kind:'text',x:7,y:3,w:4,h:2,text:'자료 검토 후 승인',fontSize:24,color:'#3182F6'}]}]};
 assert.doesNotThrow(()=>api.validateComposition('powerpoint',plan));
 for(const change of [p=>p.slides[0].elements[1].x=13,p=>p.slides[0].elements[0].script='process.exit()',p=>p.slides[0].elements[0].h=.1]){const p=structuredClone(plan);change(p);assert.throws(()=>api.validateComposition('powerpoint',p));}
});
test('Word section directives at the edges never create empty first or last pages',async()=>{
 const result=await api.composeWord({title:'Review',blocks:[{kind:'section',orientation:'landscape'},{kind:'paragraph',style:'title',text:'검토'},{kind:'section',orientation:'portrait'}]},new AbortController().signal);
 const z=await JSZip.loadAsync(result.bytes),xml=await z.file('word/document.xml').async('string');assert.equal((xml.match(/<w:sectPr>/g)||[]).length,1);assert.match(xml,/w:orient="landscape"/);
});
test('an invalid composed workbook is corrected inside the existing planning loop',async()=>{
 const good={title:'Report',sheets:[{name:'집계',widths:[20],cells:[{address:'A1',formula:'SUM(1,2)'}]}],outputs:[{metric:'total',sheet:'집계',cell:'A1'}]},bad=structuredClone(good);bad.sheets[0].cells[0].formula='SUM(XFE99)';let attempts=0,feedback='';
 const host={id:'test-model',async complete(messages){const outputs=messages.filter(m=>m.role==='tool');if(!outputs.length)return {content:'',calls:[{id:'read',function:{name:'read_excel_sources',arguments:{}}}]};if(outputs.length<3){attempts++;return {content:'',calls:[{id:'submit'+attempts,function:{name:'submit_excel_draft',arguments:attempts===1?bad:good}}]};}feedback=outputs[1].content;return {content:'Prepared',calls:[]};}};
 const result=await api.prepareComposition('excel',{request:'Prepare report',sources:{datasets:{}}},createHostModelTransport(host),new AbortController().signal,{datasets:{}});assert.equal(attempts,2);assert.equal(result.sheets[0].cells[0].formula,'SUM(1,2)');assert.match(feedback,/excel_formula_invalid/);
});
test('small composition patches preserve unrelated formulas and reject prototype paths',()=>{
 assert.equal(typeof api.applyCompositionPatch,'function');const plan={title:'Report',sheets:[{name:'관리',widths:[20,20],cells:[{address:'A1',value:'제목',role:'title'},{address:'B2',formula:'SUM(1,2)'}]}],outputs:[{metric:'total',sheet:'관리',cell:'B2'}]};
 const result=api.applyCompositionPatch('excel',plan,[{op:'add',path:'/sheets/0/paper',value:'A3'},{op:'add',path:'/sheets/0/merges',value:['A1:B1']}],{});assert.equal(result.sheets[0].paper,'A3');assert.equal(result.sheets[0].cells[1].formula,'SUM(1,2)');assert.equal(plan.sheets[0].paper,undefined);
 assert.throws(()=>api.applyCompositionPatch('excel',plan,[{op:'add',path:'/__proto__/x',value:1}],{}));
 assert.throws(()=>api.applyCompositionPatch('excel',plan,[{op:'replace',path:'/sheets/0/cells/1/formula',value:'SUM(XFE99)'}],{}));
});
test('a chart with a separately composed heading never receives a blank native title',async()=>{
 const dispatched=[],engine={async invoke(r){if(r.action==='apply'){dispatched.push(...r.ops);return {bytes:r.bytes};}return {observation:{pages:[{elements:[]}]}};}};
 await api.composePowerPoint({title:'Costs',slides:[{notes:'Synthetic',elements:[{kind:'chart',x:1,y:1,w:8,h:5,chartType:'bar',categories:['A'],series:[{name:'Cost',values:[5]}]}]}]},engine,new AbortController().signal);
 const chart=dispatched.find(o=>o.op==='addChart');assert.equal(Object.hasOwn(chart,'title'),false);
});

test('Excel composition preserves the model print pagination and actual header rows',async()=>{
 const plan={title:'Print',sheets:[{name:'Ledger',widths:[20,25],fitToHeight:1,printHeaderRows:'3:3',cells:[{address:'A1',value:'Title',role:'title'}],tables:[{row:3,col:1,dataset:'rows',columns:[{header:'ID',field:'id'},{header:'Amount',field:'amount'}]}]}],outputs:[]};
 const bytes=(await api.composeExcel(plan,{rows:[{id:'A',amount:10}]},new AbortController().signal)).bytes,z=await JSZip.loadAsync(bytes);assert.match(await z.file('xl/worksheets/sheet1.xml').async('string'),/fitToHeight="1"/);assert.match(await z.file('xl/workbook.xml').async('string'),/\$3:\$3/);
});
test('Word composition exposes native spacing and keeps a small table together when requested',async()=>{
 const plan={title:'Review',blocks:[{kind:'paragraph',text:'Readable spacing',fontSize:12,lineSpacing:1.5,spaceBefore:4,spaceAfter:8},{kind:'table',widths:[6,11],headers:['Item','Amount'],rows:[['A','1,831.80'],['B','131.00']],fontSize:11,keepTogether:true}]};
 const result=await api.composeWord(plan,new AbortController().signal);const z=await JSZip.loadAsync(result.bytes),xml=await z.file('word/document.xml').async('string');assert.match(xml,/w:line="360"/);assert.match(xml,/w:before="80"/);assert.match(xml,/w:after="160"/);assert.match(xml,/w:sz w:val="24"/);
 const table=xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/)[0];assert.equal((table.match(/<w:keepNext\s*\/>/g)||[]).length,4);assert.match(table,/w:sz w:val="22"/);assert.match(table,/w:gridCol w:w="3402"/);
 for(const change of [p=>p.blocks[0].lineSpacing=10,p=>p.blocks[1].fontSize=4,p=>p.blocks[1].keepTogether='yes']){const bad=structuredClone(plan);change(bad);assert.throws(()=>api.validateComposition('word',bad));}
});
