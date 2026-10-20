import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {saveBrowserScript,loadBrowserScript,listBrowserScripts,reviewBrowserScript,recordBrowserScriptRun,validateBrowserScriptCard,renderBrowserScriptReadme,BROWSER_SCRIPTS_DIR} from '../runtime/browser-scripts.mjs';

// Browser teach plan T5: a saved script keeps slots and sources, never values; status follows the procedure memory.
const card=()=>({schemaVersion:1,title:'견적서 제출',status:'draft',inputs:[{slot:'v1',label:'Full Name'},{slot:'v2',label:'Choose',kind:'choice'}],
  steps:[{tool:'click_element',target:{role:'link',name:'FP 산정',kind:'control',tag:'a'}},{tool:'fill_form',fields:[{target:{role:'textbox',name:'Full Name',kind:'field',tag:'input',type:'text'},slot:'v1'}]},{tool:'select_option',target:{role:'combobox',name:'Choose',kind:'control',tag:'select'},slot:'v2'},{tool:'click_element',target:{role:'button',name:'Submit',kind:'control',tag:'button'}}],
  teach:{purpose:'FP 산정 메뉴에서 견적서를 낸다',steps:{'1':{reason:'이름을 넣는다',guard:false,slot:'v1',valueSource:{kind:'mail',field:'from'}},'3':{reason:'견적을 접수한다',guard:true,assert:{text:'접수 번호가 보인다'}}}}});
async function workspace(t){const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-scripts-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('a script is saved with a readable README, loads back and is listed; a changed card returns to draft with a new version',async t=>{
  const root=await workspace(t);
  const saved=await saveBrowserScript(root,{slug:'견적서-제출',card:card()});
  assert.equal(saved.card.status,'draft');assert.equal(saved.card.version,1);
  const readme=await readFile(path.join(root,BROWSER_SCRIPTS_DIR,'견적서-제출','README.md'),'utf8');
  assert.match(readme,/# 견적서 제출/);assert.match(readme,/목적: FP 산정 메뉴에서 견적서를 낸다/);assert.match(readme,/2\. ‘Full Name’ 칸에 값을 입력 — 이름을 넣는다/);assert.match(readme,/4\. ‘Submit’ 누르기 — 견적을 접수한다 \(확인 필요\)/);assert.match(readme,/- Full Name \(v1\): 메일에서/);assert.match(readme,/- Choose \(v2\): 실행 때 묻기/);
  const loaded=await loadBrowserScript(root,'견적서-제출');assert.equal(loaded.card.title,'견적서 제출');assert.deepEqual(loaded.runs,[]);
  assert.deepEqual((await listBrowserScripts(root)).map(s=>[s.slug,s.status,s.steps,s.inputs]),[['견적서-제출','draft',4,2]]);
  await reviewBrowserScript(root,'견적서-제출');assert.equal((await loadBrowserScript(root,'견적서-제출')).card.status,'reviewed');
  const same=await saveBrowserScript(root,{slug:'견적서-제출',card:card()});assert.equal(same.card.status,'reviewed','an unchanged card keeps its status');assert.equal(same.card.version,1);
  const changed=card();changed.steps.pop();const next=await saveBrowserScript(root,{slug:'견적서-제출',card:changed});
  assert.equal(next.card.status,'draft');assert.equal(next.card.version,2);
});

test('three successful runs after review promote the script and receipts keep typed facts only',async t=>{
  const root=await workspace(t);await saveBrowserScript(root,{slug:'form',card:card()});await reviewBrowserScript(root,'form');
  assert.equal((await recordBrowserScriptRun(root,'form',{success:true,ms:3100,steps:4,toolCalls:4,stopped:null,secret:'nope'})).status,'reviewed');
  assert.equal((await recordBrowserScriptRun(root,'form',{success:false,ms:2000,stopped:'2번째 단계의 대상을 찾지 못했습니다'})).status,'reviewed');
  await recordBrowserScriptRun(root,'form',{success:true,ms:3000});await recordBrowserScriptRun(root,'form',{success:true,ms:2900});
  const promoted=await recordBrowserScriptRun(root,'form',{success:true,ms:2800});
  assert.equal(promoted.status,'revalidated','three successes in a row after review');
  const {runs,card:final}=await loadBrowserScript(root,'form');assert.equal(runs.length,5);assert.equal(final.status,'revalidated');
  assert.equal(JSON.stringify(runs).includes('nope'),false,'unknown fields are not kept');
  assert.deepEqual(Object.keys(runs[0]).sort(),['at','cardVersion','modelCalls','ms','steps','stopped','success','toolCalls']);
});

test('cards with values, unknown tools or bad slugs are refused before anything is written',async t=>{
  const root=await workspace(t);
  const withValue=card();withValue.steps[1].fields[0].value='홍길동';
  await assert.rejects(saveBrowserScript(root,{slug:'bad',card:withValue}),/browser_script_value_retained/);
  const withText=card();withText.teach.steps['1'].valueSource={kind:'literal',text:'비밀'};
  await assert.rejects(saveBrowserScript(root,{slug:'bad',card:withText}),/browser_script_value_retained/);
  const badTool=card();badTool.steps.push({tool:'run_playwright',code:'x'});
  await assert.rejects(saveBrowserScript(root,{slug:'bad',card:badTool}),/browser_script_step_invalid/);
  await assert.rejects(saveBrowserScript(root,{slug:'../escape',card:card()}),/browser_script_slug_invalid/);
  await assert.rejects(loadBrowserScript(root,'none'),/browser_script_missing/);
  assert.deepEqual(await listBrowserScripts(root),[]);
  assert.throws(()=>validateBrowserScriptCard({schemaVersion:1,title:'t',inputs:[],steps:[]}),/browser_script_card_invalid/);
  assert.match(renderBrowserScriptReadme(card()),/값은 이 파일과 card.json에 저장하지 않는다/);
});
