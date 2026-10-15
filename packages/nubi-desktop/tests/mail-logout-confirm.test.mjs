import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {logoutNotice,logoutConfirmationScript} from '../electron-app/mail-logout-confirm.cjs';
function page({url='https://www.samsung.net/loginapp/abnormal-logout',buttons=1,password=false,hidden=false}={}){
 let clicks=0;const button={innerText:'확인',getClientRects:()=>hidden?[]:[{}],getAttribute:()=>null,closest:()=>null,click:()=>clicks++};
 const document={documentElement:{dataset:{}},querySelectorAll:query=>query==='input[type="password"]'?(password?[button]:[]):Array(buttons).fill(button)};
 const context={URL,location:{href:url},document,getComputedStyle:()=>({visibility:'visible',display:'block'})};
 return {run:()=>vm.runInNewContext(logoutConfirmationScript,context),clicks:()=>clicks};
}
test('logout acknowledgment is exact-origin, one-time and never a credential submission',()=>{
 for(const route of ['abnormal-logout','logout']){const p=page({url:'https://www.samsung.net/loginapp/'+route});assert.equal(p.run(),'acknowledged');assert.equal(p.run(),'already');assert.equal(p.clicks(),1);}
 for(const options of [{buttons:2},{hidden:true},{password:true},{url:'https://www.samsung.net/loginapp/login'},{url:'https://evil.test/loginapp/logout'},{url:'http://www.samsung.net/loginapp/logout'},{url:'https://www.samsung.net.evil.test/loginapp/logout'}]){const p=page(options);p.run();assert.equal(p.clicks(),0);}
 assert.equal(logoutNotice('https://user:pass@www.samsung.net/loginapp/logout'),false);assert.equal(logoutNotice('https://www.samsung.net:444/loginapp/logout'),false);
});
test('packaging does not insert runtime helpers into the injected acknowledgment script',async()=>{
 const {build}=await import('esbuild');const {createRequire}=await import('node:module');
 const result=await build({entryPoints:[new URL('../electron-app/mail-logout-confirm.cjs',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',minify:true,keepNames:true,write:false});
 const module={exports:{}};vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url)});
 assert.equal(module.exports.logoutConfirmationScript,logoutConfirmationScript);
});
