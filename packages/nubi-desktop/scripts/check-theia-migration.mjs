import {_electron} from 'playwright';
import {mkdtemp,mkdir,writeFile,rm,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-theia-migration-')),root=path.join(dir,'project');
await mkdir(root);await writeFile(path.join(root,'sample.txt'),'before\n');
for(const args of [['init','-b','main'],['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','fixture']])execFileSync('git',args,{cwd:root,stdio:'pipe'});
await writeFile(path.join(root,'sample.txt'),'after\n');
const start=performance.now();let app,page;const errors=[],checks=[];
try{
 app=await _electron.launch({args:[path.resolve('electron-app'),root,'--hostname=127.0.0.1','--port=0'],env:{...process.env,THEIA_CONFIG_DIR:path.join(dir,'ide'),NUBI_STORAGE_ROOT:path.join(dir,'state')},timeout:60000});
 page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
 await page.getByRole('button',{name:'Yes, I trust the authors',exact:true}).click({timeout:45000});
 await page.locator('.aipro-login .provider-button').first().waitFor();await page.locator('.theia-preload').waitFor({state:'hidden'});
 const readyMs=Math.round(performance.now()-start);
 assert.equal(await page.locator('.nubi-workspace-rail').count(),1);
 await page.getByRole('button',{name:'Git 변경',exact:true}).click();
 const git=page.getByRole('dialog',{name:'Git 변경',exact:true});await git.getByRole('button',{name:/sample.txt/}).click();await git.locator('pre').getByText(/\+after/).waitFor();
 assert((await git.locator('pre').innerText()).includes('-before'));await git.getByRole('button',{name:'파일 열기',exact:true}).click();
 await page.locator('.monaco-editor:visible').waitFor();
 const boxes=await page.evaluate(()=>{const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};return {agent:rect(document.querySelector('#nubi-workspace')),editor:rect(document.querySelector('.monaco-editor'))};});
 assert(boxes.agent.width>300);assert(boxes.editor.x>=boxes.agent.x+boxes.agent.width-5);checks.push('Git change reads actual HEAD diff and opens the source beside the permanent agent');
 assert.equal(await page.locator('#nubi-workspace').isVisible(),true);
 const tab=page.locator('.lm-TabBar-tab').filter({has:page.getByText('에이전트',{exact:true})});assert.equal(await tab.locator('.lm-TabBar-tabCloseIcon').isVisible(),false,await tab.evaluate(node=>node.outerHTML));checks.push('main agent remains visible and has no close control');
 await page.getByRole('button',{name:'파일',exact:true}).click();await page.getByText('sample.txt',{exact:true}).filter({visible:true}).last().dblclick();await page.locator('.monaco-editor:visible').waitFor();assert(await page.locator('#nubi-workspace').isVisible());checks.push('native navigator keeps the agent beside the file');
 await page.getByRole('button',{name:'검색',exact:true}).click();await page.locator('#search-in-workspace:visible').waitFor();checks.push('native source search opens from the Nubi rail');
 await page.getByRole('button',{name:'터미널',exact:true}).click();await page.locator('.xterm:visible').waitFor();assert(await page.locator('#nubi-workspace').isVisible());checks.push('native terminal opens without replacing the agent');
 await page.getByRole('button',{name:'도구',exact:true}).click();await page.getByRole('combobox').filter({visible:true}).first().waitFor();await page.keyboard.press('Escape');checks.push('native command palette remains available');
 await page.screenshot({path:'verification/theia-migration.png'});
 await page.reload();await page.locator('.aipro-login .provider-button').first().waitFor();assert(await page.locator('#nubi-workspace').isVisible());assert(await page.locator('.monaco-editor:visible').count()>0);checks.push('renderer reload restores agent and editor together');
 assert.deepEqual(errors,[]);const bundle=await stat('electron-app/lib/frontend/bundle.js');
 const result={passed:true,platform:process.platform,readyMs,includesHumanTrustClick:true,mode:'production',frontendBytes:bundle.size,boxes,checks,errors,scope:'Mac Electron source build, isolated Git fixture and fresh state. No Windows installer, real provider or company SSO claim.'};
 await writeFile('verification/theia-migration.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}catch(error){await page?.screenshot({path:'verification/theia-migration-failure.png'}).catch(()=>{});if(page)await writeFile('verification/theia-migration-failure.txt',await page.locator('body').innerText());throw error;}
finally{await app?.close();await rm(dir,{recursive:true,force:true});}
