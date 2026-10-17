import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PlaywrightHost}=require('../electron-app/playwright-host.cjs');
function fixture(url,authFlow){const row={automationDocument:'doc',authFlow,view:{webContents:{getURL:()=>url,isDestroyed:()=>false}}};return new PlaywrightHost({tab:()=>row});}
test('an active SAML round trip and SAML response endpoint remain outside automation',()=>{
 for(const url of ['https://service.invalid/saml/acs','https://service.invalid/home?SAMLResponse=synthetic'])assert.throws(()=>fixture(url).row('tab'),/browser_auth_protected/);
 assert.throws(()=>fixture('https://idp.invalid/login',{active:true,settled:false}).row('tab'),/browser_auth_protected/);
 assert.equal(fixture('https://service.invalid/work',{active:true,settled:true}).row('tab').automationDocument,'doc');
});
