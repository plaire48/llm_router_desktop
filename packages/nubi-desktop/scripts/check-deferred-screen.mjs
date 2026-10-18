import {build} from 'esbuild';
import {chromium} from 'playwright';
import path from 'node:path';
import assert from 'node:assert/strict';
const bundle=await build({entryPoints:['tests/deferred-screen-fixture.jsx'],bundle:true,write:false,outdir:'/tmp/nubi-deferred-screen',format:'iife',platform:'browser',loader:{'.webp':'file'},alias:Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),define:{'process.env.NODE_ENV':'"production"'}});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
 const chat=page.getByRole('textbox',{name:'채팅 초안'});await chat.fill('기존 초안');assert.equal(await page.evaluate(()=>window.loads),0);
 await page.getByRole('button',{name:'화면 전환'}).click();await page.getByRole('status').waitFor();await chat.fill('로딩 중에도 입력');
 await page.evaluate(()=>window.rejectScreen());await page.getByRole('alert').waitFor();assert.equal(await chat.inputValue(),'로딩 중에도 입력');
 await page.getByRole('button',{name:'다시 불러오기'}).click();await page.getByRole('status').waitFor();assert.equal(await page.evaluate(()=>window.loads),2);
 await page.evaluate(()=>window.resolveScreen());const field=page.getByRole('textbox',{name:'화면 입력'});await field.fill('화면 초안');await page.getByRole('button',{name:'상태 갱신'}).click();await page.getByText('부모 상태 1',{exact:true}).waitFor();assert.equal(await field.inputValue(),'화면 초안');assert.equal(await chat.inputValue(),'로딩 중에도 입력');
 await page.getByRole('button',{name:'화면 전환'}).click();await page.getByRole('button',{name:'화면 전환'}).click();await field.waitFor();assert.equal(await page.evaluate(()=>window.loads),2,'successful retry is reused on re-entry');assert.equal(await chat.inputValue(),'로딩 중에도 입력');
 assert.deepEqual(errors,[]);console.log('PASS: unopened screen does not load; delayed/rejected load preserves chat input; retry works; parent polling does not reset the loaded screen.');
}finally{await browser.close();}
