import {removeLater} from './helpers-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';import path from 'node:path';

// The packaged app bundles and minifies the main process, which rewrote the placeholder's quotes so the mail origin was
// never filled in and every page read as signed out (user report 2026-10-14: login done, "확인 중" forever). The bundled
// script must name the real origin.
test('the bundled mail reader script names the mail origin, not the placeholder',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-portal-bundle-'));removeLater(dir);
  const result=await build({entryPoints:['electron-app/mail-portal-contract.cjs'],bundle:true,platform:'node',format:'cjs',minify:true,write:false,logLevel:'silent'});
  const file=path.join(dir,'contract.cjs');await writeFile(file,result.outputFiles[0].text);
  const contract=createRequire(import.meta.url)(file);
  const source=contract.portalFetchSource();
  assert.ok(!source.includes('__NUBI_PORTAL_ORIGIN__'));assert.ok(source.includes(JSON.stringify(contract.ORIGIN)));
  const {runInNewContext}=await import('node:vm');
  const packet=await runInNewContext(`(${source})({operation:'approvalItem',ap:'a',ln:'l',reportFailure:true})`,{location:{origin:contract.ORIGIN},URLSearchParams,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,fetch:async()=>new Response('private',{status:502})});
  assert.equal(packet.__nubiPortalError,'mail_portal_unavailable');assert.equal(packet.httpStatus,502);assert(!JSON.stringify(packet).includes('private'));
});

test('the packaged credential form script has no hidden bundler helper dependencies',async t=>{
 const {runInNewContext}=await import('node:vm');
 const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-credential-bundle-'));removeLater(dir);
 const result=await build({entryPoints:['electron-app/mail-credential-login.cjs'],bundle:true,platform:'node',format:'cjs',minify:true,keepNames:true,write:false,logLevel:'silent'});
 const file=path.join(dir,'login.cjs');await writeFile(file,result.outputFiles[0].text);const {submitLogin}=createRequire(import.meta.url)(file);
 assert.equal(runInNewContext(`(${submitLogin.toString()})({username:'fixture',password:'fixture'})`,{location:{protocol:'https:',hostname:'samsung.net',pathname:'/loginapp/login'},document:{querySelectorAll:()=>[]}}),'form_required');
});
