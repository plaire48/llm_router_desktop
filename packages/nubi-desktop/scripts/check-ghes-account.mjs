import {build} from 'esbuild';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {fixture} from '../tests/fixtures.mjs';

const require=createRequire(import.meta.url),{GhesAccount,ORIGIN}=require('../../nubi-vscode/src/ghes.cjs');
const {Host}=require('../../nubi-vscode/src/host.cjs');
const cleanup=[],{service,root}=await fixture({after:fn=>cleanup.push(fn)}),out=path.resolve('verification/ghes-account');await mkdir(out,{recursive:true});
let approve=false,marketplaceRefresh=0,repositoryPicks=0,copied=0,updateState='unchecked',installedVersion='2.0.0';
const credentials=new Map(),privateToken='HOST_ONLY_PRIVATE_FIXTURE',browserOpens=[],requests=[],secretBodies=[];
const account=new GhesAccount({secrets:{get:async k=>credentials.get(k),store:async(k,v)=>credentials.set(k,v),delete:async k=>credentials.delete(k)},openExternal:async url=>{browserOpens.push(url);return true;},copyCode:async()=>{copied++;},waiter:async()=>new Promise(r=>setTimeout(r,100)),onInvalidated:async()=>service.disconnectSkillMarketplace(),fetcher:async(url,options)=>{
  requests.push({url,authorization:options.headers.Authorization});
  if(url.endsWith('/login/device/code'))return Response.json({device_code:'DEVICE_PRIVATE_FIXTURE',user_code:'NUBI-1234',verification_uri:ORIGIN+'/login/device',expires_in:900,interval:5});
  if(url.endsWith('/login/oauth/access_token'))return Response.json(approve?{access_token:privateToken,token_type:'bearer',expires_in:28800}:{error:'authorization_pending'});
  if(url.endsWith('/api/v3/user'))return Response.json({id:42,login:'nubi-user',name:'누비 사용자',company:'Manufacturing IT',email:'nubi-user@example.test',html_url:ORIGIN+'/nubi-user'});
  throw Error('unexpected fixture route');
}});
const host=new Host({workspace:{isTrusted:true,workspaceFolders:[{uri:{scheme:'file',fsPath:root}}]},env:{}},{invoke:(method,args)=>service.invoke(method,args)},{account});host.root=root;
service.marketplaceReader={async tree(){
  const data={'.agents/plugins/marketplace.json':JSON.stringify({name:'ai-workspace',plugins:[{name:'simple-addition',source:{source:'local',path:'./plugins/simple-addition'}}]}),'plugins/simple-addition/.codex-plugin/plugin.json':JSON.stringify({name:'simple-addition',version:'1.0.0',description:'두 수를 더하고 결과를 확인합니다.',interface:{displayName:'간단 덧셈'}}),'plugins/simple-addition/skills/simple-addition/SKILL.md':'---\nname: simple-addition\ndescription: 두 수를 더합니다.\n---\nSum two numbers.'};
  return {commit:createHash('sha1').update('1.0.0').digest('hex'),files:Object.entries(data).map(([file,value])=>({path:file,mode:'100644',type:'blob',size:Buffer.byteLength(value),bytes:Buffer.from(value)}))};},async blob(entry){return entry.bytes;}};
await build({entryPoints:['tests/ghes-account-ui-fixture.jsx'],outfile:path.join(out,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(n=>[n,path.resolve('node_modules',n)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(out,'icons'),{recursive:true});
await writeFile(path.join(out,'index.html'),'<!doctype html><html lang="ko"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{
  try{
    if(req.method==='POST'){
      let body='';for await(const chunk of req)body+=chunk;const args=JSON.parse(body);let result;
      if(req.url==='/api'){if(args.method==='skillMarketplace'&&args.args.operation==='refresh')marketplaceRefresh++;result=await host.api(args.method,args.args);}
      else if(req.url==='/account')result=await account.action(args.operation);
      else if(req.url==='/approve'){approve=true;result={ok:true};}
      else if(req.url==='/marketplace')result=await host.connectMarketplace();
      else if(req.url==='/update'){
        if(args.operation==='check')updateState='update_available';
        if(args.operation==='install')updateState='restart_required';
        if(args.operation==='restart'){installedVersion='2.1.0';updateState='installed_verified';}
        result={state:updateState,installedVersion,availableVersion:updateState==='unchecked'?null:'2.1.0',supported:true,kind:'nubi_features'};
      }else if(req.url==='/repositories'){await account.credential();repositoryPicks++;result={cloned:true};}
      else throw Error('input_invalid');
      const text=JSON.stringify(result);secretBodies.push(text);assert(!text.includes(privateToken)&&!text.includes('DEVICE_PRIVATE_FIXTURE'));res.setHeader('content-type','application/json');res.end(text);return;
    }
    const file=path.resolve(out,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(out+path.sep))throw Error();
    res.setHeader('content-type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
  }catch(e){res.writeHead(req.method==='POST'?400:404,{'content-type':'application/json'}).end(JSON.stringify({error:e.message}));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser,page;const checks=[],errors=[];
try{
  browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  const draft=page.getByRole('textbox',{name:'작업 요청'});await draft.fill('메일 첨부와 Wiki를 대조해 주세요.');
  const rail=page.getByRole('navigation',{name:'프로젝트 도구'}),person=rail.getByRole('button',{name:'회사 계정 메뉴'});
  const avatarBox=await person.locator('.nubi-account-avatar').boundingBox();assert(avatarBox?.width>=20&&avatarBox.height>=20);assert(avatarBox.x<48&&avatarBox.y>=750);assert.equal(await person.locator('.nubi-account-avatar').evaluate(el=>getComputedStyle(el).borderRadius),'50%');checks.push('person glyph is visible at a readable size in the native workspace rail');await person.click();
  const dialog=page.getByRole('dialog',{name:'회사 계정',exact:true});const tokens=[...new Set([...String(await readFile('ui/ghes-account.css')).matchAll(/var\((--[\w-]+)/g)].map(match=>match[1]))];const unresolved=await dialog.evaluate((el,tokens)=>tokens.filter(token=>!getComputedStyle(el).getPropertyValue(token).trim()),tokens);assert.deepEqual(unresolved,[]);checks.push('all account color typography spacing and icon tokens resolve to the shared CX theme');await page.emulateMedia({reducedMotion:'no-preference'});assert.equal(await dialog.evaluate(el=>getComputedStyle(el).animationName),'deck-rise');assert(await dialog.evaluate(el=>el.getAnimations().length>0));await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await dialog.evaluate(el=>getComputedStyle(el).animationName),'none');checks.push('modal uses existing Nubi entrance motion and obeys the system reduced motion setting');await dialog.getByRole('button',{name:'회사 SSO로 로그인'}).waitFor();assert.equal(await dialog.locator('input[type=password]').count(),0);assert((await dialog.getByRole('button',{name:'회사 SSO로 로그인'}).boundingBox()).height>=44);await page.screenshot({path:path.join(out,'login-1280.png'),animations:'disabled'});assert.equal(await dialog.locator('.cx-panel-body').evaluate(el=>getComputedStyle(el).paddingTop),'32px');checks.push('person entry opens one concise company account modal without collecting SAML passwords');
  await dialog.getByRole('button',{name:'회사 SSO로 로그인'}).click();await dialog.getByText('NUBI-1234',{exact:true}).waitFor();assert.deepEqual(browserOpens,[ORIGIN+'/login/device']);checks.push('device challenge is visible while the company browser SSO authorization remains pending');
  await dialog.getByRole('button',{name:'로그인 코드 복사'}).click();assert.equal(copied,1);await dialog.getByRole('button',{name:'로그인 취소'}).click();await dialog.getByRole('button',{name:'회사 SSO로 로그인'}).waitFor();assert.equal(credentials.size,0);checks.push('copy and cancel use native host actions and cancellation stores no late credential');
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();await page.waitForTimeout(50);assert.equal(await person.evaluate(el=>el===document.activeElement),true);assert.equal(await draft.inputValue(),'메일 첨부와 Wiki를 대조해 주세요.');checks.push('closing the account preserves the current conversation draft');
  await rail.getByRole('button',{name:'스킬',exact:true}).click();const manager=page.getByRole('region',{name:'스킬 관리',exact:true});await manager.getByRole('button',{name:'스킬 설정',exact:true}).click();await manager.getByRole('button',{name:'회사 GitHub 연결',exact:true}).waitFor();await manager.getByRole('button',{name:'회사 GitHub 연결',exact:true}).click();await dialog.getByText('NUBI-1234',{exact:true}).waitFor();
  await page.request.post('http://127.0.0.1:'+server.address().port+'/approve',{data:{}});await dialog.waitFor({state:'hidden'});await manager.getByRole('button',{name:'스킬 찾기',exact:true}).click();await manager.getByRole('article',{name:'간단 덧셈',exact:true}).waitFor();assert.ok(marketplaceRefresh>=1);assert.equal(service.marketplaceToken,privateToken);checks.push('SSO completion resumes only the requested marketplace read and returns to the skill manager');
  await rail.getByRole('button',{name:'누비 사용자 계정 메뉴'}).click();await dialog.getByText('@nubi-user',{exact:true}).waitFor();assert(Number(await dialog.getByRole('heading',{name:'누비 사용자',exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).fontSize)))>=20);assert.equal(account.view().connected,true);await dialog.getByText('Manufacturing IT',{exact:true}).waitFor();await dialog.getByText('nubi-user@example.test',{exact:true}).waitFor();assert.equal(await dialog.locator('.nubi-account-info dl').evaluate(el=>getComputedStyle(el).rowGap),'16px');assert.equal(await dialog.locator('.nubi-account-profile').evaluate(el=>getComputedStyle(el).marginBottom),'24px');assert.equal(await dialog.getByRole('button',{name:'회사 저장소 열기',exact:true}).isVisible(),false);await page.screenshot({path:path.join(out,'profile-1280.png'),animations:'disabled'});await dialog.getByText('설정',{exact:true}).click();checks.push('verified display name and account login replace the guest identity');
  await dialog.getByRole('button',{name:'회사 저장소 열기',exact:true}).click();assert.equal(repositoryPicks,1);checks.push('repository selection uses a native authenticated host operation');
  await dialog.getByRole('button',{name:'최신 버전 확인',exact:true}).click();await dialog.getByRole('button',{name:'업데이트 설치',exact:true}).click();await dialog.getByRole('button',{name:'누비 다시 시작',exact:true}).click();await dialog.getByText('설치 버전 2.1.0',{exact:true}).waitFor();checks.push('update UI distinguishes a available release installation request restart and verified version');
  await dialog.getByText('설정',{exact:true}).click();await page.screenshot({path:path.join(out,'account-1280.png'),animations:'disabled'});
  for(const width of [440,320]){
    await page.setViewportSize({width,height:800});await page.waitForTimeout(100);
    const box=await dialog.boundingBox();assert(box.x>=0&&box.x+box.width<=width+1);assert(box.y>=0&&box.y+box.height<=801);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
    await page.screenshot({path:path.join(out,`account-${width}.png`),animations:'disabled'});checks.push(`company account remains readable inside a ${width}px viewport`);
  }
  await dialog.getByRole('button',{name:'로그아웃',exact:true}).click();await dialog.getByRole('button',{name:'회사 SSO로 로그인'}).waitFor();assert.equal(credentials.size,0);assert.equal(service.marketplaceToken,null);assert.equal(service.marketplaceCatalog,null);checks.push('logout removes secure host credentials and the private marketplace catalog');
  await page.reload();await rail.getByRole('button',{name:'회사 계정 메뉴'}).waitFor();assert.equal(await page.getByRole('button',{name:'누비 사용자 계정 메뉴'}).count(),0);checks.push('re-entry does not restore a logged-out profile');
  assert(!JSON.stringify(secretBodies).includes(privateToken));assert(!await page.locator('body').innerText().then(text=>text.includes(privateToken)));assert.deepEqual(errors,[]);checks.push('rendered content and every UI RPC response contain no credential or device secret');
  await writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,checks,scope:'Actual shared Workbench, GhesAccount Device Flow and ProjectService with synthetic GHES/SSO/provider/installation. No live company authentication or Windows installation.'},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
}catch(e){if(page)await page.screenshot({path:path.join(out,'failure.png')});await writeFile(path.join(out,'failure.json'),JSON.stringify({checks,error:e.message,diagnostic:page?await page.evaluate(()=>({dialogs:[...document.querySelectorAll('[role=dialog]')].map(el=>({name:el.getAttribute('aria-labelledby'),text:el.innerText,hidden:el.closest('[aria-hidden=true]')?.tagName,attrs:el.outerHTML.slice(0,500)})),hidden:[...document.querySelectorAll('[aria-hidden=true]')].map(el=>({tag:el.tagName,class:el.className,id:el.id}))})):null},null,2));throw e;}
finally{account.dispose();await browser?.close();await new Promise(r=>server.close(r));for(const clean of cleanup)await clean();}
