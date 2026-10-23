import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {DESIGN_MOTION_FILES,sourceDesignIssues,assertDesignRules,assertAccessibilityRules} from './design-rules.mjs';
const sourceIssues=[];
for(const file of DESIGN_MOTION_FILES)sourceIssues.push(...sourceDesignIssues(file,await readFile(file,'utf8')));
assert.deepEqual(sourceIssues,[],'Motion values belong to workspace-motion.css');
// :has() recalculated the whole document's style on every DOM change (design light-flow §1.1, §6: zero in app CSS);
// those facts are attributes now (ui/shell-state.mjs: root facts and LOCAL_HAS).
{const {readdir}=await import('node:fs/promises');const pathModule=await import('node:path');
 const cssFiles=async dir=>(await readdir(dir,{withFileTypes:true})).flatMap(e=>e.isDirectory()?(dir==='electron-app'&&e.name==='lib')||e.name==='node_modules'?[]:[pathModule.join(dir,e.name)]:e.name.endsWith('.css')?[pathModule.join(dir,e.name)]:[]);
 const walk=async dirs=>{const out=[];for(const d of dirs){for(const entry of await cssFiles(d)){if(entry.endsWith('.css'))out.push(entry);else out.push(...await walk([entry]));}}return out;};
 const found=[];for(const file of await walk(['design','ui','electron-app']))for(const issue of sourceDesignIssues(file,await readFile(file,'utf8'),{has:true}))if(issue.rule==='has_selector')found.push(file+':'+issue.line+' '+issue.selector);
 assert.deepEqual(found,[],':has() is replaced by shell-state attributes');}
const browser=await chromium.launch({channel:'chrome',headless:true}),checks=[];
const style='<style>:root{--nubi-surface-base:white;--nubi-motion-enter:280ms;--nubi-motion-exit:180ms;--nubi-motion-press:120ms;--nubi-motion-state:180ms}@media(prefers-reduced-motion:reduce){:root{--nubi-motion-enter:120ms;--nubi-motion-exit:120ms;--nubi-motion-state:120ms}}[data-design-surface]{padding:20px}.tint{background:rgb(230,240,255)}</style>';
try{
 const page=await browser.newPage();
 // G5 contracts use this existing browser run; no extra application scenes.
 for(const [rule,html] of [
  ['accessible_name','<button><svg aria-hidden="true"></svg></button>'],
  ['accessible_name','<a href="#"><img alt=""></a>'],
  ['accessible_name','<button disabled><svg aria-hidden="true"></svg></button>'],
  ['contrast','<p style="color:black;background:#666">정의되지 않은 muted 토큰</p>'],
  ['contrast','<p style="color:#aaa;background:white">본문 대비</p>'],
  ['modal_focus','<button autofocus>밖</button><section role="dialog"><button>안</button></section>']
 ]){await page.setContent(style+html);await assert.rejects(()=>assertAccessibilityRules(page),new RegExp(rule));checks.push('accessibility reject:'+rule);}
 await page.setContent(style+'<button><img alt="그림 저장"></button><button aria-labelledby="label"><svg aria-hidden="true"></svg></button><span id="label">파일 열기</span>');
 await assertAccessibilityRules(page);checks.push('accessible names preserve image alternatives and labelledby');
 await page.setContent(style+'<p style="color:#191f28;background:linear-gradient(112deg,rgb(232,241,254),rgb(239,236,253))">밝은 배경</p>');await assertAccessibilityRules(page);checks.push('conservative pastel gradient contrast is measured');
 await page.setContent(style+'<p style="color:#777;background:linear-gradient(112deg,rgb(0,0,0),rgb(255,255,255))">중간 대비</p>');await assert.rejects(()=>assertAccessibilityRules(page),/contrast/);checks.push('gradient spanning foreground luminance fails');
 await page.setContent(style+'<p style="color:white;background:linear-gradient(145deg,color(srgb 0.123137 0.415686 0.876863),rgb(27,100,218))">실행</p>');await assertAccessibilityRules(page);checks.push('modern srgb gradient includes conservative Oklab interpolation bounds');
 await page.setContent(style+'<p style="color:#778899;background:linear-gradient(145deg,color(srgb .123137 .415686 .876863),rgb(27,100,218))">낮은 대비</p>');await assert.rejects(()=>assertAccessibilityRules(page),/contrast/);checks.push('modern srgb gradient does not excuse low contrast');
 await page.setContent(style+'<p style="color:white;background:linear-gradient(145deg,color(display-p3 .1 .4 .8),rgb(27,100,218))">미지원 색공간</p>');await assert.rejects(()=>assertAccessibilityRules(page),/contrast_unmeasured/);checks.push('wide gamut gradient remains unmeasured');
 await page.setContent(style+'<p style="color:black;background-image:url(data:image/png;base64,AA)">측정 불가</p>');await assert.rejects(()=>assertAccessibilityRules(page),/contrast_unmeasured/);checks.push('unknown image backgrounds cannot silently pass');
 await assert.rejects(()=>assertAccessibilityRules(page,{exceptions:[{id:'synthetic',rule:'contrast',selector:'p',maxMatches:1}]}),/reason/);checks.push('exceptions require a recorded reason');
 await page.setContent('<p style="color:black;background-image:url(data:image/png;base64,AA)">합성 예외</p>');
 const declared={id:'synthetic-background',rule:'contrast_unmeasured',selector:'p:nth-child(1)',maxMatches:1,reason:'Synthetic contract fixture verifies bounded, exact-match declarations.'};
 const reviewed=await assertAccessibilityRules(page,{exceptions:[declared]});assert.equal(reviewed.accepted.length,1);checks.push('exact declared exception remains visible in result');
 await page.locator('p').evaluate(n=>n.className='changed');await assert.rejects(()=>assertAccessibilityRules(page,{exceptions:[declared]}),/contrast_unmeasured/);checks.push('changed target does not inherit an old exception');
 await page.setContent(style+'<p style="--nubi-text-muted:#777;color:var(--nubi-text-muted);background:white">보조</p>');
 // A token declared only on the text is not the shared root token.
 await assert.rejects(()=>assertAccessibilityRules(page),/contrast/);
 await page.addStyleTag({content:':root{--nubi-text-muted:#777}'});await assertAccessibilityRules(page);checks.push('only the actual shared muted token uses the 3:1 threshold');
 await page.setContent(style+'<div style="opacity:0"><time>보이지 않는 날짜</time></div><p>표시되는 본문</p>');await assertAccessibilityRules(page);checks.push('fully transparent ancestor text is not falsely measured');
 await page.setContent(style+'<button style="opacity:0"></button>');await assert.rejects(()=>assertAccessibilityRules(page),/accessible_name/);checks.push('transparent but focusable controls still require names');

 await page.setContent(style+'<button>밖</button><section role="dialog"><button id="inside">안</button></section>');await page.locator('#inside').focus();
 await assert.rejects(()=>assertAccessibilityRules(page),/modal_focus/);checks.push('accessibility rejects actual Tab escape');
 await page.setContent(style+'<button>밖</button><section role="dialog"><button id="a">하나</button><button id="b">둘</button></section>');
 await page.evaluate(()=>{const a=document.querySelector('#a'),b=document.querySelector('#b');a.focus();document.querySelector('[role=dialog]').addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();(document.activeElement===a?b:a).focus();}});});
 const accessible=await assertAccessibilityRules(page);assert(accessible.focus.forward>0&&accessible.focus.reverse>0);assert.equal(await page.locator('#a').evaluate(n=>n===document.activeElement),true);checks.push('actual modal Tab cycle restores original focus');

 for(const[rule,html]of [
  ['primary_actions','<button class="cx-button--primary">A</button><button class="cx-button--primary">B</button>'],
  ['duplicate_title','<header><h1>설정</h1></header><section><h2>설정</h2></section>'],
  ['nested_tint','<section data-design-surface class="tint"><div data-design-surface class="tint">nested</div></section>'],
  ['raw_error','<p role="alert">workflow_schema</p>'],
  ['sidebar_overlap','<div class="nubi-sidebar-folder-picker"><span style="position:absolute;left:0;top:0">프로젝트</span></div><div class="nubi-sidebar-search"><span style="position:absolute;left:0;top:0">검색</span></div>']
 ]){
  await page.setContent(style+html);
  await assert.rejects(()=>assertDesignRules(page),new RegExp(rule));
  checks.push('reject:'+rule);
 }
 await page.setContent(style+'<button class="cx-button--primary">underlying one</button><button class="cx-button--primary">underlying two</button><section role="dialog"><header><h2>설정</h2></header><h3>모델</h3><pre>workflow_schema</pre><details open><summary>자세히</summary><p role="alert">workflow_schema</p></details><button class="cx-button--primary">저장</button></section>');
 await assertDesignRules(page);checks.push('active dialog scope preserves authored content and explicit details');
 await page.setContent(style+'<form><button class="cx-button--primary">반영</button></form><section role="region"><button disabled class="cx-button--primary">승인</button></section><form class="composer"><button class="cx-button--primary">전송</button></form>');
 await assertDesignRules(page);checks.push('one active action per existing independent form/card/composer');
 await page.setContent(style+'<form><button class="cx-button--primary">A</button><button class="cx-button--primary">B</button></form>');
 await assert.rejects(()=>assertDesignRules(page),/primary_actions/);checks.push('reject:two active primary actions in one form');
 await page.setContent(style+'<section role="dialog"><form><button class="cx-button--primary">A</button></form><form><button class="cx-button--primary">B</button></form></section>');
 await assert.rejects(()=>assertDesignRules(page),/primary_actions/);checks.push('reject:multiple primary actions across forms inside the top modal');
 await page.setContent(style+'<form><button class="cx-button--primary">저장</button></form>');
 await page.setContent(style+'<section aria-label="승인 하나"><button class="cx-button--primary">A</button></section><section aria-label="승인 둘"><button class="cx-button--primary">B</button></section>');
 await assertDesignRules(page);checks.push('native labelled section landmarks are independent cards');
 await page.setContent(style+'<form><section role="region"><button class="cx-button--primary">A</button></section><section role="region"><button class="cx-button--primary">B</button></section></form>');
 await assert.rejects(()=>assertDesignRules(page),/primary_actions/);checks.push('nested regions cannot subdivide one form to bypass the rule');
 await page.setContent(style+'<form><button class="cx-button--primary">저장</button></form>');
 await page.emulateMedia({reducedMotion:'reduce'});await assertDesignRules(page);checks.push('reduced motion tokens <=120ms');
 await page.setViewportSize({width:440,height:900});await page.setContent('<div class="desktop-shell"><div class="nubi-workbench"><aside class="nubi-sidebar" data-open="true">합성 프로젝트</aside><div class="nubi-sidebar-scrim"></div></div></div>');
 await page.addStyleTag({content:await readFile('design/workspace-motion.css','utf8')+'\n'+await readFile('design/workspace-identity.css','utf8')});
 const sidebar=await page.locator('.nubi-sidebar').evaluate(element=>element.getAnimations().map(animation=>({name:animation.animationName,duration:animation.effect.getTiming().duration,frames:animation.effect.getKeyframes()})));
 assert(sidebar.every(animation=>animation.duration<=120&&animation.frames.every(frame=>!('transform' in frame))), 'Reduced sidebar must not translate: '+JSON.stringify(sidebar));assert.equal(await page.locator('.nubi-sidebar').evaluate(element=>getComputedStyle(element).transform),'none');checks.push('actual sidebar CSS reduced motion never translates');await page.close();
 await mkdir('verification/design-rules',{recursive:true});
 await writeFile('verification/design-rules/result.json',JSON.stringify({ok:true,checks,boundary:'Synthetic browser contract cases; actual UI scenes call the same helper separately.'},null,2));
 console.log(JSON.stringify({ok:true,checks}));
}finally{await browser.close();}
