import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ghesFailureText,ghesMessages,ghesBrowserFailures} from '../ui/ghes-account-state.mjs';
const require=createRequire(import.meta.url);
const {ElectronHost}=require('../electron-app/native-host.cjs');

const BARE='회사 계정을 확인하지 못했어요';
test('codes the account can end in have their own message that says what to do',()=>{
 for(const code of ['ghes_network','ghes_session_expired','ghes_response_invalid','ghes_storage','ghes_storage_read','ghes_login_failed','ghes_identity_invalid','ghes_device_invalid','ghes_response_limit','ghes_cancelled','ghes_sso_required','ghes_redirect_refused','secret_unavailable','browser_unavailable','ghes_browser_unavailable']){
  const text=ghesFailureText(code);assert.ok(Object.hasOwn(ghesMessages,code),code);assert.doesNotMatch(text,new RegExp(BARE),code);assert.match(text,/주세요|확인해요/,code);
 }
});

test('an unknown failure still tells the person what to do and keeps only a short code',()=>{
 assert.match(ghesFailureText('operation_failed'),/연결 다시 확인.*다시 로그인해 주세요\. \(operation_failed\)$/);
 assert.doesNotMatch(ghesFailureText('Error: TypeError fetch failed <html>'),/\(/,'raw messages are never shown');
 assert.doesNotMatch(ghesFailureText(''),/\(/);
 assert.ok(ghesFailureText('toString').startsWith(BARE),'inherited names are not messages');
});

test('a company page in the way offers the in-app company login',()=>{
 for(const code of ['ghes_sso_required','ghes_network','ghes_response_invalid'])assert.ok(ghesBrowserFailures.has(code),code);
 assert.equal(ghesBrowserFailures.has('ghes_session_expired'),false);
});

test('a key-store write failure surfaces as ghes_storage, not a bare login failure',async()=>{
 const host=new ElectronHost({keyStore:{setPassword:async()=>{throw Error('secret_unavailable');},getPassword:async()=>null,deletePassword:async()=>{}},invoke:async()=>{}});
 await assert.rejects(host.account.secrets.store('nubi.ghes.code.sdsdev.co.kr','{}'),/^Error: ghes_storage$/);
 host.dispose();
});
