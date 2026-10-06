import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {git} from '../runtime/files.mjs';
import {assertDesktopDialog} from './identity-browser.mjs';
const temp=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-ui-')),root=path.join(temp,'project');await mkdir(root);await git(root,['init','-q']);await writeFile(path.join(root,'README.md'),'Mail UI fixture');
const port=4347,backend=spawn(process.execPath,['browser-app/lib/backend/main.js',root,'--hostname=127.0.0.1','--port='+port],{env:{...process.env,THEIA_CONFIG_DIR:path.join(temp,'theia'),NUBI_STORAGE_ROOT:path.join(temp,'state')},stdio:['ignore','pipe','pipe']});let logs='';backend.stdout.on('data',d=>logs+=d);backend.stderr.on('data',d=>logs+=d);
let browser;const checks=[],errors=[];
try{
 for(let i=0;i<150;i++){try{if((await fetch('http://127.0.0.1:'+port)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});const p=await browser.newPage({viewport:{width:1380,height:1000}});p.on('pageerror',e=>errors.push(e.message));await p.goto('http://127.0.0.1:'+port);await p.getByRole('button',{name:'Yes, I trust the authors'}).click();await p.getByRole('button',{name:'OpenWiki',exact:true}).waitFor();
 await p.getByRole('button',{name:'OpenWiki',exact:true}).click();await p.getByRole('button',{name:'사내 메일',exact:true}).click();let dialog=p.locator('.cx-panel-backdrop.is-modal > .nubi-panel');await p.getByRole('form',{name:'사내 메일 연결 정보'}).waitFor();await assertDesktopDialog(dialog);assert.equal(await p.getByLabel('비밀번호',{exact:true}).getAttribute('type'),'password');assert.equal(await p.getByRole('button',{name:'메일 연결'}).isDisabled(),true);checks.push('actual Theia OpenWiki opens dedicated mail RPC status with password form');
 assert.equal(await dialog.getByText(/pop3.samsung.net|995|TLS/).count(),0);assert.equal(await dialog.getByText(/마지막 확인/).count(),0);assert.equal(await dialog.getByRole('search').count(),0);assert.equal(await dialog.locator('details[open]').count(),0);checks.push('initial view hides server specs, storage details, empty counts and search');await p.screenshot({path:'verification/mail/theia-connected-form.png',fullPage:true});
 await p.reload();await p.getByRole('button',{name:'OpenWiki',exact:true}).waitFor();await p.getByRole('button',{name:'설정',exact:true}).click();await p.getByRole('button',{name:'사내 메일',exact:true}).click();await p.getByLabel('비밀번호',{exact:true}).waitFor();assert.equal(await p.getByLabel('비밀번호',{exact:true}).inputValue(),'');checks.push('renderer reload and settings reentry retain host status without credential values');
 await p.setViewportSize({width:440,height:950});await assertDesktopDialog(dialog);await p.screenshot({path:'verification/mail/theia-narrow.png',fullPage:true});assert.deepEqual(errors,[]);await writeFile('verification/mail/host-result.json',JSON.stringify({scope:'actual Theia/Node host, no POP3 or model login',checks},null,2));console.log(JSON.stringify({checks}));
}catch(error){console.error(logs.slice(-2000));throw error;}
finally{await browser?.close();backend.kill('SIGTERM');await new Promise(r=>{backend.once('exit',r);setTimeout(r,3000);});await rm(temp,{recursive:true,force:true});}
