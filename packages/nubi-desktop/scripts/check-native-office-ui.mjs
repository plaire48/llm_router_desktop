import {nativeExcelFixture} from '../tests/native-excel-fixture.mjs';
import {auditSurfaceTokens} from './surface-token-audit.mjs';
import {nativeDocumentUIData} from '../tests/native-document-ui-data.mjs';
import {build,stop} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fixture} from '../tests/fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);
const out=path.resolve(process.env.NUBI_NATIVE_UI_OUTPUT||'../../artifacts/workspace-native-1/ui');await mkdir(out,{recursive:true});
await build({entryPoints:['tests/native-office-ui-fixture.jsx'],outfile:path.join(out,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{'process.env.NODE_ENV':'"production"'}});
await writeFile(path.join(out,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
let current,writes=0,documentData;const cleanup=[];const {service}=await fixture({after:fn=>cleanup.push(fn)});
const read={action:'get',member:'Text'};
const excelReads=[{action:'get',member:'Worksheets.Item',args:[1],id:'sheet'},{target:'sheet',action:'get',member:'Name'},{target:'sheet',action:'get',member:'Range',args:['A1:F7'],id:'table'},{target:'table',action:'get',member:'Value2'},{target:'sheet',action:'get',member:'Range',args:['F7'],id:'total'},{target:'total',action:'get',member:'Formula'},{action:'get',member:'Worksheets.Item',args:[2],id:'basis'},{target:'basis',action:'get',member:'Name'},{target:'basis',action:'get',member:'Range',args:['A1:B3'],id:'basisCells'},{target:'basisCells',action:'get',member:'Value2'}];
const excelData=[['분기 매출 계획',null,null,null,null,null],['구분','1월','2월','3월','목표','분기 합계'],['플랫폼',2400,2800,3100,8000,8300],['컨설팅',1500,1700,2000,5000,5200],['유지보수',800,800,900,2400,2500],['교육',400,500,600,1500,1500],['합계',5100,5800,6600,16900,16000]];
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
async function prepare(app){
 documentData=app==='excel'?(()=>{const cells={};excelData.forEach((row,r)=>row.forEach((value,c)=>cells[String.fromCharCode(65+c)+(r+1)]={value}));cells.F7={formula:'=SUM(F3:F5)'};return nativeExcelFixture([{id:1,name:'매출 계획',cells,evaluate:(f,c)=>{const sum=last=>Array.from({length:last-2},(_,i)=>c['F'+(i+3)].value).reduce((a,b)=>a+b,0);if(f==='=SUM(F3:F5)')return sum(5);if(f==='=SUM(F3:F6)')return sum(6);if(f==='=ROUND(SUM(F3:F6)*1.1,0)')return Math.round(sum(6)*1.1);throw Error('unknown golden formula');}},{id:2,name:'수정 근거',cells:{A1:{value:'확인 항목'},B1:{value:'값'},A2:{value:'누락 매출'},B2:{value:1500},A3:{value:'합계 예상'},B3:{value:17500}},evaluate:()=>0}]);})():nativeDocumentUIData(app);
 current=await service.createTask({request:`${app} 검토 보고서의 본문 수정`});let text='Before',turn=0;writes=0;
 service.registerNativeOfficeConnection({environment:'fixture',app,scope:{projectId:service.projectId,taskId:current.id},documentId:'report-doc',documentTitle:documentData?.title||'검토 보고서',officeSessionId:'fixture-session',async call(name,args){
  if(documentData){const result=await documentData.call(name,args);writes=documentData.writes;return result;}
  if(name==='inspect_office')return {snapshotId:'snapshot',results:args.steps.map(s=>app==='excel'?s.id?{reference:s.id}:s.member==='Name'?s.target==='basis'?'수정 근거':'매출 계획':s.member==='Value2'?s.target==='table'?excelData:s.target==='basisCells'?[['확인 항목','값'],['누락 매출',1500],['합계 예상',17500]]:17500:s.member==='Formula'?text==='Before'?'=SUM(F3:F5)':'=SUM(F3:F6)':null:s.member==='Value2'?3:text)};
  if(name==='calculate_office')return {status:'calculated',calculationDone:true};
  writes++;text='승인된 본문';return {status:'verified',mutated:true,completedWrites:1,writeResultUncertain:false,saved:false,checks:args.checks.map(()=>({passed:true}))};
 }},{allowFixture:true});
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages){
  if(turn++===0)return call('inspect_native_office',{steps:app==='excel'?excelReads:documentData.steps});
  if(turn===2){const observationId=JSON.parse(messages.findLast(m=>m.role==='tool').content).observationId;return call('write_native_office',app==='excel'?{observationId,summary:'분기 합계에서 누락된 교육 매출을 포함합니다.',steps:[{target:'total',action:'set',member:'Formula',value:'=SUM(F3:F6)'}],checks:[{read:{target:'total',action:'get',member:'Formula'},equals:'=SUM(F3:F6)'}],calculateTarget:'sheet',afterChecks:[{read:{target:'total',action:'get',member:'Value2'},equals:17500}]}:{observationId,summary:'현재 문서의 검토 초안을 확정 문구로 변경',steps:[documentData.mutation],checks:[{read:{...documentData.mutation,action:'get',value:undefined},equals:documentData.mutation.value}]});}
  if(turn===3){if(app==='excel'){assert.match(JSON.stringify(messages),/19800/);assert.match(JSON.stringify(messages),/ROUND/);}else{assert.match(JSON.stringify(messages),/사용자 검토 확정/,'the existing host model receives the human-edited approved text');assert(!JSON.stringify(messages).includes('editTargets'),'UI edit projections are absent from the resumed model context');}return call('finish_native_office',{receiptId:service.nativeOfficeStatus({taskId:current.id}).outcome.receiptId});}
  return {content:'변경을 재확인했습니다. 아직 저장하지 않았습니다.',calls:[]};
 }};
 await service.startAgent({taskId:current.id});await service.agent.promise;
}
const server=createServer(async(req,res)=>{try{
 if(req.url==='/state'){res.setHeader('content-type','application/json');res.end(JSON.stringify(service.task(current.id)));return;}
 if(req.url==='/revise'){let data='';for await(const c of req)data+=c;res.setHeader('content-type','application/json');try{res.end(JSON.stringify(await service.invoke('reviseNativeOfficeDraft',{taskId:current.id,...JSON.parse(data)})));}catch(e){res.statusCode=400;res.end(JSON.stringify({error:e.message}));}return;}
 if(req.url==='/answer'){let data='';for await(const c of req)data+=c;await service.answerAgent({taskId:current.id,choice:JSON.parse(data)});await service.agent.promise;res.end('{}');return;}
 const file=path.resolve(out,'.'+(req.url==='/'?'/index.html':req.url));if(!file.startsWith(out+path.sep))throw Error('scope');res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file));
 }catch(e){res.statusCode=400;res.end(e.message);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));const checks=[];
try{
 for(const app of ['word','excel','powerpoint'])for(const width of [1280,440]){
  await prepare(app);await page.setViewportSize({width,height:1100});await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const form=page.getByRole('region',{name:'답변이 필요한 질문'});await form.waitFor();await auditSurfaceTokens(page,`native-${app}-${width}`);
  if(app==='excel'){
   const preview=page.getByRole('region',{name:'Excel 변경 미리보기',exact:true});await preview.waitFor();await preview.getByRole('button',{name:/F7 변경 셀/}).click();await page.getByLabel('선택한 셀 수식 또는 값').filter({hasText:'=SUM(F3:F6)'}).waitFor();
   assert.equal(await preview.getByRole('group',{name:'변경 비교'}).count(),0);assert.equal(await preview.locator('del').count(),0);assert.equal(await preview.getByLabel('변경 내역',{exact:true}).count(),0);await preview.getByRole('button',{name:/^변경 내역/}).click();await preview.getByLabel('변경 내역',{exact:true}).filter({hasText:'=SUM(F3:F5)'}).waitFor();await preview.getByRole('button',{name:/^변경 내역/}).click();
   assert.equal(await page.locator('.nubi-tool-arguments').getAttribute('open'),null);assert.equal(await page.locator('.nubi-tool-arguments pre').count(),0);
   await page.locator('.nubi-tool-arguments summary').click();await page.getByLabel('도구 실행 인자',{exact:true}).waitFor();assert.match(await page.getByLabel('도구 실행 인자',{exact:true}).innerText(),/SUM\(F3:F6\)/);await page.locator('.nubi-tool-arguments summary').click();await page.waitForFunction(()=>!document.querySelector('.nubi-tool-arguments pre'));
   const changedCell=preview.getByRole('button',{name:/^F7 변경 셀/}).locator('..');
   const changedShade=await changedCell.evaluate(el=>getComputedStyle(el).backgroundColor);
   await preview.getByRole('button',{name:/^F6:/}).click();
   assert.equal(await changedCell.getAttribute('data-selected'),null,'changed shade must not depend on selection');
   assert.equal(await changedCell.evaluate(el=>getComputedStyle(el).backgroundColor),changedShade);
   assert.notEqual(changedShade,await preview.getByRole('button',{name:/^E7:/}).locator('..').evaluate(el=>getComputedStyle(el).backgroundColor),'changed cell has its own shade');
   await preview.getByRole('button',{name:/^F7 변경 셀/}).click();
   const scroll=preview.getByRole('region',{name:'매출 계획 시트 셀',exact:true});await scroll.evaluate(el=>{el.scrollLeft=40;el.dispatchEvent(new Event('scroll',{bubbles:true}));});const left=await scroll.evaluate(el=>el.scrollLeft);
   await preview.getByRole('button',{name:'Excel 미리보기 접기',exact:true}).click();assert.equal(await preview.locator('table').count(),0);assert.equal(await preview.getByLabel('선택한 셀 수식 또는 값').count(),0);assert.equal(await preview.getByRole('tablist').count(),0);assert.equal(writes,0);await page.screenshot({path:path.join(out,`excel-${width}-collapsed.png`),fullPage:true,animations:'disabled'});
   await preview.getByRole('button',{name:'Excel 미리보기 펼치기',exact:true}).click();await preview.locator('table').waitFor();assert.equal(await scroll.evaluate(el=>el.scrollLeft),left);assert.match(await page.getByLabel('선택한 셀 수식 또는 값').innerText(),/=SUM\(F3:F6\)/);
   await preview.getByRole('tab',{name:'수정 근거',exact:true}).click();await preview.getByRole('button',{name:/A2: 누락 매출/}).waitFor();await preview.getByRole('tab',{name:'매출 계획',exact:true}).click();
   await preview.getByRole('button',{name:/^F6:/}).dblclick();await preview.getByRole('textbox',{name:'셀 값',exact:true}).fill('2000');assert.equal(await form.getByRole('button',{name:'답변 보내기',exact:true}).isDisabled(),true);await preview.getByRole('button',{name:'계산 검증',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.nubi-excel-editor'));assert.equal(writes,0);
   await preview.getByRole('button',{name:/^F7 변경 셀/}).dblclick();const formula=preview.getByRole('textbox',{name:'수식',exact:true});await formula.fill('=SUM(Z99)');await preview.getByRole('button',{name:'계산 검증',exact:true}).click();await preview.getByRole('alert').filter({hasText:'Z99'}).waitFor();assert.equal(await form.getByRole('button',{name:'답변 보내기',exact:true}).isDisabled(),true);assert.equal(writes,0);await preview.screenshot({path:path.join(out,`excel-${width}-calculation-error.png`),animations:'disabled'});
   await formula.fill('=ROUND(SUM(F3:F6)*1.1,0)');await preview.getByRole('button',{name:'계산 검증',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.nubi-excel-editor'));await preview.getByRole('button',{name:/^F7 변경 셀: 19,800/}).waitFor();assert.equal(writes,0);assert.equal(documentData.calculations,0);

  }else{
   const label=app==='word'?'Word':'PowerPoint',preview=page.getByRole('region',{name:`${label} 변경 미리보기`,exact:true});await preview.waitFor();
   assert.equal(await preview.locator('del').count(),0);assert.equal(await preview.getByLabel('변경 내역',{exact:true}).count(),0);
   const shaded=preview.locator(app==='word'?'.nubi-office-changed-text':'.nubi-ppt-shape[data-changed]').first();assert.equal(await shaded.evaluate((el,app)=>getComputedStyle(el,app==='powerpoint'?'::before':null).backgroundColor==='rgba(0, 0, 0, 0)',app),false,'changed content has a visible review shade');
   const content=app==='word'?preview.locator('.nubi-word-paper'):preview.locator('.nubi-ppt-canvas');await content.waitFor();assert.match(await content.innerText(),/검토 확정/);assert.equal(await preview.getByRole('group',{name:'변경 비교'}).count(),0);
   if(app==='word'){
    await preview.locator('.nubi-word-paper p[data-changed]').click();await preview.getByRole('textbox',{name:'문단 내용',exact:true}).fill('사용자 검토 확정: 3개 부서부터 적용합니다.');
   }else{
    const shape=preview.getByRole('button',{name:'핵심 메시지',exact:true});await shape.dblclick();await preview.getByRole('textbox',{name:'도형 문구',exact:true}).fill('사용자 검토 확정\n3개 부서 시범 적용');
   }
   assert.equal(await form.getByRole('button',{name:'답변 보내기',exact:true}).isDisabled(),true);if(width===1280)await preview.screenshot({path:path.join(out,`${app}-text-editor.png`),animations:'disabled'});await preview.getByRole('button',{name:'초안에 적용',exact:true}).click();await page.waitForFunction(selector=>document.querySelector(selector)?.textContent.includes('사용자 검토 확정'),app==='word'?'.nubi-word-paper':'.nubi-ppt-canvas');assert.equal(writes,0);
   if(app==='powerpoint'){
    const shape=preview.getByRole('button',{name:'핵심 메시지',exact:true}),box=await shape.boundingBox();const old=service.task(current.id).nativeOffice.pending.args.steps.length;
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();assert.equal(await form.getByRole('button',{name:'답변 보내기',exact:true}).isDisabled(),true);await page.mouse.move(box.x+box.width/2+30,box.y+box.height/2+20,{steps:5});await page.mouse.up();
    for(let i=0;i<100&&service.task(current.id).nativeOffice.pending.args.steps.length===old;i++)await new Promise(r=>setTimeout(r,10));assert(service.task(current.id).nativeOffice.pending.args.steps.some(s=>s.member==='Left'&&s.value>62));assert.equal(writes,0);
    await preview.getByRole('button',{name:'위치·크기',exact:true}).click();await preview.getByRole('spinbutton',{name:'너비',exact:true}).fill('400');await preview.getByRole('button',{name:'초안에 적용',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.nubi-document-editor'));
   }
   await preview.getByRole('button',{name:'주변 내용 보기',exact:true}).click();
   const selector=preview.getByLabel(`${label} 미리보기 ${app==='word'?'페이지':'슬라이드'} 선택`);await selector.selectOption('1');
   if(app==='word'){await preview.getByRole('table',{name:'표 1'}).waitFor();await preview.locator('.nubi-word-table td').first().click();await preview.getByRole('textbox',{name:'표 셀 내용',exact:true}).fill('사용자 확인');assert.equal(writes,0);await preview.getByRole('button',{name:'초안에 적용',exact:true}).click();await preview.locator('.nubi-word-table td').first().filter({hasText:'사용자 확인'}).waitFor();}else{await preview.getByRole('button',{name:'세 가지 검증',exact:true}).click();assert.equal(await preview.getByRole('button',{name:'세 가지 검증',exact:true}).getAttribute('aria-pressed'),'true');}
   const viewport=preview.getByRole('region',{name:`${label} 문서 화면`,exact:true});await viewport.evaluate(el=>{el.scrollTop=70;el.dispatchEvent(new Event('scroll',{bubbles:true}));});const top=await viewport.evaluate(el=>el.scrollTop);
   await preview.getByRole('button',{name:`${label} 미리보기 접기`,exact:true}).click();assert.equal(await preview.locator('.nubi-word-paper,.nubi-ppt-canvas,.nubi-ppt-shape,select').count(),0);await page.screenshot({path:path.join(out,`${app}-${width}-collapsed.png`),fullPage:true,animations:'disabled'});
   await preview.getByRole('button',{name:`${label} 미리보기 펼치기`,exact:true}).click();await content.waitFor();assert.equal(await selector.inputValue(),'1');assert.equal(await viewport.evaluate(el=>el.scrollTop),top);
   if(app==='powerpoint')assert.equal(await preview.getByRole('button',{name:'세 가지 검증',exact:true}).getAttribute('aria-pressed'),'true');
   if(app==='word')await page.screenshot({path:path.join(out,`word-${width}-table.png`),fullPage:true,animations:'disabled'});
   await selector.selectOption('0');assert.equal(await viewport.evaluate(el=>el.scrollTop),0);
   assert.equal(await page.locator('.nubi-tool-arguments pre').count(),0);
   if(app==='powerpoint'){const notes=preview.getByRole('button',{name:'발표자 메모 펼치기',exact:true});await notes.click();await preview.getByLabel('발표자 메모',{exact:true}).waitFor();await preview.getByRole('button',{name:'발표자 메모 접기',exact:true}).click();assert.equal(await preview.getByLabel('발표자 메모',{exact:true}).count(),0);}await preview.getByRole('button',{name:'변경 부분만 보기',exact:true}).click();
  }assert.equal(writes,0);
  const activePreview=page.getByRole('region',{name:app==='excel'?'Excel 변경 미리보기':`${app==='word'?'Word':'PowerPoint'} 변경 미리보기`,exact:true}),compare=activePreview.getByRole('button',{name:'원본 잠깐 보기',exact:true});
  await compare.focus();await page.keyboard.down('Space');assert.equal(await compare.getAttribute('aria-pressed'),'true');assert.equal(await form.getByRole('button',{name:'답변 보내기',exact:true}).isDisabled(),true);if(app==='excel'){assert.match(await activePreview.getByLabel('선택한 셀 수식 또는 값').innerText(),/SUM\(F3:F5\)/);assert.equal(await activePreview.locator('td[data-changed]').count(),0,'original view hides modification shading');}else {assert.match(await activePreview.locator(app==='word'?'.nubi-word-paper':'.nubi-ppt-canvas').innerText(),/검토 초안/);if(app==='word')assert.equal(await activePreview.locator('.nubi-office-changed-text').count(),0);else assert.equal(await activePreview.locator('.nubi-ppt-shape[data-changed]').count(),0);}if(width===1280)await activePreview.screenshot({path:path.join(out,`${app}-original-held.png`),animations:'disabled'});
  await page.keyboard.up('Space');assert.equal(await compare.getAttribute('aria-pressed'),'false');assert.equal(writes,0);

  await page.waitForFunction(()=>window.notices.some(n=>n.action==='show'));const notice=await page.evaluate(()=>window.notices.find(n=>n.action==='show'));assert.equal(notice.openLabel,'변경 확인');assert.equal(notice.choices,undefined);
  assert.equal(await form.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
  await form.getByRole('radio',{name:/실행/}).click();assert.equal(writes,0);
  assert.equal(await page.locator('del').count(),0);
  if(app==='excel'){await page.waitForFunction(()=>document.querySelector('.question-send:not(:disabled)'));assert.equal(await page.locator('.nubi-excel-preview td[data-selected]').evaluate(el=>getComputedStyle(el).outlineColor),'rgb(33, 115, 70)');}
  await page.waitForFunction(()=>{const button=document.querySelector('.question-send:not(:disabled)');return button&&getComputedStyle(button).backgroundColor==='rgb(49, 130, 246)';});
  const heading=page.locator(app==='excel'?'.nubi-excel-preview-heading':'.nubi-document-preview-heading');assert.equal(await heading.evaluate(el=>getComputedStyle(el).backgroundColor),app==='excel'?'rgb(33, 115, 70)':app==='word'?'rgb(24, 90, 189)':'rgb(183, 71, 42)');assert.equal(await heading.evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
  await page.screenshot({path:path.join(out,`${app}-${width}.png`),fullPage:true,animations:'disabled'});await page.getByRole('region',{name:app==='excel'?'Excel 변경 미리보기':`${app==='word'?'Word':'PowerPoint'} 변경 미리보기`,exact:true}).screenshot({path:path.join(out,`${app}-${width}-preview.png`),animations:'disabled'});
  if(width===440){await page.evaluate(()=>document.body.style.zoom='1.25');assert.equal(await form.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);await page.screenshot({path:path.join(out,`${app}-440-zoom.png`),fullPage:true,animations:'disabled'});await page.evaluate(()=>document.body.style.zoom='');}
  await form.getByRole('button',{name:'답변 보내기',exact:true}).click();await page.getByLabel('문서 처리 상태').filter({hasText:'verified_unsaved'}).waitFor();assert.equal(writes,1);assert.equal(service.nativeOfficeStatus({taskId:current.id}).outcome.savedToOffice,false);
  checks.push({app,width,previewAccentOnly:true,changesFocusedByDefault:true,originalComparisonAccessible:true,inlineStrikeRemoved:true,approval:'exact_once',native:'fixture',ui:'source_component',unsaved:true,...(app==='excel'?{collapsedGridUnmounted:true,collapsedArgumentsUnmounted:true,viewAndScrollRestored:true,humanCellValueApplied:true,humanFormulaApplied:true,invalidFormulaBlocksApproval:true,localCalculationVerified:true,nativeCalculationAndReadbackVerified:true}:{collapsedDocumentUnmounted:true,viewAndScrollRestored:true,inlineChanges:true,changedContentShaded:true,humanTextApplied:true,humanRevisionInHostContext:true,...(app==='word'?{humanTableCellApplied:true}:{}),...(app==='powerpoint'?{humanDragApplied:true,humanResizeApplied:true}:{})} )});
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'result.json'),JSON.stringify({checks,errors,windowsNotificationVerified:false,office2016Verified:false,nascaVerified:false},null,2));console.log(JSON.stringify({checks:checks.length,errors}));
}catch(error){await writeFile(path.join(out,'failure.json'),JSON.stringify({task:service.task(current.id),writes,error:error.message},null,2));await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw error;}finally{await browser.close();await new Promise(r=>server.close(r));for(const fn of cleanup)await fn();stop();}
