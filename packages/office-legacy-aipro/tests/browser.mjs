import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createApp } from '../server/app.mjs';
import { fakeExcel } from './fake-excel.mjs';
import { mockAiPro } from './mock-aipro.mjs';

let app, browser; const server=createServer((req,res)=>app.handler(req,res));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
app=createApp({origin,webRoot:fileURLToPath(new URL('../dist/web',import.meta.url)),fetchImpl:mockAiPro});
const output=new URL('../verification/',import.meta.url); await mkdir(output,{recursive:true});
try {
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
  const page=await browser.newPage({viewport:{width:380,height:800}}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://appsforoffice.microsoft.com/**',route=>route.fulfill({contentType:'text/javascript',body:`window.testFixture=(${fakeExcel.toString()})();window.Excel=testFixture.excel;window.Office={context:{requirements:{isSetSupported:function(name,version){return name==='ExcelApi'&&version==='1.1';}}},onReady:function(callback){setTimeout(callback,0);}};`}));
  await page.goto(origin+'/taskpane.html');
  await page.getByRole('button',{name:'AI Pro CLI로 연결',exact:true}).click();
  await page.getByLabel('Base URL',{exact:true}).fill('https://example.com/v1');
  await page.getByLabel('토큰',{exact:true}).fill('synthetic-test-token');
  await page.getByLabel('Model ID',{exact:true}).fill('test-model');
  await page.getByRole('button',{name:'연결 설정 저장',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('settings').hidden);
  assert.equal(await page.getByLabel('토큰',{exact:true}).inputValue(),'');
  await page.screenshot({path:fileURLToPath(new URL('welcome-380.png',output))});
  await page.getByRole('button',{name:'머리글 서식 정리'}).click();
  await page.getByRole('button',{name:'전송',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('적용하고 결과를 확인했습니다'));
  assert.equal(await page.evaluate(()=>testFixture.state.styles[0][0].bold),true);
  await page.screenshot({path:fileURLToPath(new URL('applied-380.png',output))});
  for(const width of [320,600]) {
    await page.setViewportSize({width,height:720});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:fileURLToPath(new URL(`applied-${width}.png`,output))});
  }
  await page.getByRole('button',{name:'연결 설정',exact:true}).click();
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('button',{name:'연결 설정',exact:true}).getAttribute('aria-expanded'),'false');
  await page.getByLabel('Excel 작업 요청',{exact:true}).fill('머리글을 수정해줘');
  await page.route('**/api/run-state',async route=>{const response=await route.fetch();const state=await response.json();if(state.action?.name==='apply_changes')await page.evaluate(()=>{testFixture.state.values[0][0]=999;});await route.fulfill({response});});
  const before=await page.evaluate(()=>testFixture.state.writes);
  await page.getByRole('button',{name:'전송',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('셀 내용이 바뀌었습니다'));
  assert.equal(await page.evaluate(()=>testFixture.state.writes),before);
  assert.equal(await page.getByLabel('Excel 작업 요청',{exact:true}).inputValue(),'머리글을 수정해줘');
  await page.getByRole('button',{name:'새 대화',exact:true}).click();
  assert.equal(await page.getByLabel('Excel 작업 요청',{exact:true}).inputValue(),'');
  await page.getByRole('button',{name:'대화 기록',exact:true}).click();
  await page.locator('.history-item').first().click();
  assert.equal(await page.getByLabel('Excel 작업 요청',{exact:true}).inputValue(),'머리글을 수정해줘');
  assert.deepEqual(errors,[]);
  const evidence={date:new Date().toISOString(),browser:'Chromium with mocked Office.js and AI Pro',engine:'Original Nubi pi-agent-core@0.86.1 runtime',passed:['CLI form and credential clearing','Pi tool loop with Excel apply/readback','320/380/600px no horizontal overflow','settings Escape and focus','stale cell conflict preserves draft without write','new chat and history restore','no browser JS errors'],actualExcel2016Verified:false,actualIE11Verified:false,liveAiProVerified:false};
  await writeFile(new URL('local-checks.json',output),JSON.stringify(evidence,null,2)+'\n'); console.log(JSON.stringify(evidence,null,2));
} finally {await browser?.close();app.close();server.close();server.closeAllConnections();}
