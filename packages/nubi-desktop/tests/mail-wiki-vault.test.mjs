import {removeLater} from './helpers-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {MailWikiVault,encryptPage,decryptPage,KEY_NAME} from '../runtime/mail-wiki-vault.mjs';

const memorySecrets=()=>{const map=new Map();return {get:async key=>map.get(key)??null,set:async(key,value)=>{map.set(key,value);},map};};
const fixture=async t=>{const root=await mkdtemp(path.join(os.tmpdir(),'nubi-wiki-vault-'));removeLater(root);return {root,store:path.join(root,'wiki'),session:path.join(root,'session-wiki')};};
const wait=ms=>new Promise(r=>setTimeout(r,ms));

test('pages round-trip through AES-256-GCM and a tampered page is refused',()=>{
  const key=randomBytes(32),bytes=encryptPage(key,'# 예산 확인\n\n본문');
  assert.equal(bytes.subarray(0,4).toString(),'NWK1');assert.equal(decryptPage(key,bytes),'# 예산 확인\n\n본문');
  const tampered=Buffer.from(bytes);tampered[tampered.length-1]^=1;assert.throws(()=>decryptPage(key,tampered),/mail_wiki_key/);
  assert.throws(()=>decryptPage(randomBytes(32),bytes),/mail_wiki_key/);assert.throws(()=>decryptPage(key,Buffer.from('plain')),/mail_wiki_format/);
});

test('first run creates the key, encrypts legacy plain pages one way and serves a session copy',async t=>{
  const {store,session}=await fixture(t),secrets=memorySecrets();
  await rm(store,{recursive:true,force:true});await (await import('node:fs/promises')).mkdir(store,{recursive:true});
  await writeFile(path.join(store,'one.md'),'# 하나');
  const vault=new MailWikiVault({storeRoot:store,sessionRoot:session,secrets});
  assert.equal(await vault.ready(),true);assert.equal(vault.state,'on');assert.match(secrets.map.get(KEY_NAME),/^[0-9a-f]{64}$/);
  const result=await vault.hydrate();assert.deepEqual(result,{pages:1,migrated:1});
  assert.deepEqual((await readdir(store)).sort(),['one.md.enc']);assert.equal(await readFile(path.join(session,'one.md'),'utf8'),'# 하나');
  await vault.persist('two.md',"# 둘");assert.equal(decryptPage(vault.key,await readFile(path.join(store,'two.md.enc'))),'# 둘');
  await vault.dispose();await assert.rejects(stat(session));
  // A second runtime with the same key sees both pages; the plain copy is rebuilt, not read from disk.
  const again=new MailWikiVault({storeRoot:store,sessionRoot:session,secrets});await again.ready();assert.deepEqual(await again.hydrate(),{pages:2,migrated:0});
  assert.deepEqual((await readdir(session)).sort(),['one.md','two.md']);await again.dispose();
});

test('a page edited in the session copy is encrypted again, and a removed page leaves the store',async t=>{
  const {store,session}=await fixture(t),secrets=memorySecrets();
  const vault=new MailWikiVault({storeRoot:store,sessionRoot:session,secrets});await vault.ready();await vault.hydrate();
  await vault.persist('page.md','v1');await writeFile(path.join(session,'page.md'),'v1');
  await writeFile(path.join(session,'page.md'),'v2 edited on the wiki screen');
  vault.touch('page.md');await vault.sync();
  assert.equal(decryptPage(vault.key,await readFile(path.join(store,'page.md.enc'))),'v2 edited on the wiki screen');
  await rm(path.join(session,'page.md'));vault.touch('page.md');await vault.sync();
  assert.deepEqual(await readdir(store),[]);
  await vault.dispose();
});

test('without a usable vault the state is unavailable and nothing is written',async t=>{
  const {store,session}=await fixture(t);
  const vault=new MailWikiVault({storeRoot:store,sessionRoot:session,secrets:{get:async()=>{throw Error('secret_unavailable');},set:async()=>{}}});
  assert.equal(await vault.ready(),false);assert.equal(vault.state,'unavailable');assert.deepEqual(await vault.hydrate(),{pages:0,migrated:0});
  await vault.persist('x.md','plain');await assert.rejects(stat(store));await vault.dispose();
});
