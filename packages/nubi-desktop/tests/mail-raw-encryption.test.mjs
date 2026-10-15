import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,stat,copyFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {PersonalMail} from '../runtime/mail.mjs';
import {normalizePortalMail} from '../runtime/mail-portal-content.mjs';
import {RAW_KEY_NAME,encryptRaw,decryptRaw} from '../runtime/mail-raw-vault.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const raw=Buffer.from('From: sender@example.test\r\nTo: owner@example.test\r\nSubject: PRIVATE SUBJECT\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=xyz\r\n\r\n--xyz\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<b>PRIVATE BODY</b>\r\n--xyz\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=private.txt\r\n\r\nPRIVATE ATTACHMENT\r\n--xyz--\r\n');
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-raw-encryption-')),values=new Map(),secrets={get:async key=>values.get(key)||null,set:async(key,value)=>{values.set(key,value);}};
 const host={storageRoot:path.join(root,'state'),connectionVault:secrets},options={personalRoot:path.join(root,'mail')};let mail;
 const start=()=>{mail=new PersonalMail(host,options);mail.autoWiki=false;return mail;};start();
 const close=async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);};
 t.after(async()=>{await close();await rm(root,{recursive:true,force:true,maxRetries:3});});
 return {root,values,secrets,get mail(){return mail;},async restart(){await close();start();},close,async import(){await mail.prepare();await mail.rawMigration;await mail.intake({mails:[{...await normalizePortalMail(raw),uidl:'fixture',protocol:'local'}]},mail.generation,{collectOnly:true,accountId:'fixture'});return mail.rows()[0];}};
}
test('automatic originals, body manifests and attachment bytes are encrypted; read, export, restart and move preserve hashes',async t=>{
 const f=await fixture(t),row=await f.import(),directory=path.join(f.mail.rawRoot,row.id);
 const files=await readdir(directory);assert(files.every(name=>name.endsWith('.enc')));assert(files.includes('message.eml.enc'));assert(files.includes('manifest.json.enc'));assert(files.some(name=>name.endsWith('.bin.enc')));
 for(const name of files){const bytes=await readFile(path.join(directory,name));assert(!bytes.includes(Buffer.from('PRIVATE')));assert(!bytes.includes(Buffer.from('sender@example.test')));}
 const source=await f.mail.read(row.id,{includePresentation:true});assert.match(source.mail.presentation.html,/PRIVATE BODY/);
 assert.match((await f.mail.readAttachmentBytes(source,source.mail.attachments[0])).toString(),/PRIVATE ATTACHMENT/);
 const download=await f.mail.download({id:row.id,kind:'raw',expectedSourceHash:row.sourceHash});assert.deepEqual(Buffer.from(download.bytes,'base64'),raw);
 await f.restart();await f.mail.prepare();assert.equal((await f.mail.read(row.id)).sourceHash,sha(raw));
 await f.mail.relocateRaw(path.join(f.root,'elsewhere'));assert.match((await f.mail.read(row.id)).mail.text,/PRIVATE BODY/);assert((await readdir(path.join(f.mail.rawRoot,row.id))).every(name=>name.endsWith('.enc')));
 await f.restart();await f.mail.prepare();assert.equal((await f.mail.read(row.id)).sourceHash,row.sourceHash);
});
test('old plaintext originals migrate automatically and a crash after encrypted write before unlink is recoverable',async t=>{
 const f=await fixture(t),row=await f.import(),directory=path.join(f.mail.rawRoot,row.id);
 for(const name of await readdir(directory)){const plain=name.slice(0,-4),bytes=await f.mail.rawVault.read(path.join(directory,plain));await writeFile(path.join(directory,plain),bytes);if(plain!=='message.eml')await rm(path.join(directory,name));}
 await f.restart();await f.mail.ensureRaw();await f.mail.rawMigration;
 assert.equal(f.mail.rawVault.progress.state,'completed');assert((await readdir(directory)).every(name=>name.endsWith('.enc')));assert.equal((await f.mail.read(row.id)).sourceHash,row.sourceHash);
});
test('no vault or lost key blocks collection and never overwrites a saved original or creates a replacement key',async t=>{
 const f=await fixture(t),row=await f.import(),file=path.join(f.mail.rawRoot,row.id,'message.eml.enc'),before=await readFile(file);await f.close();f.values.delete(RAW_KEY_NAME);await f.restart();
 await assert.rejects(f.mail.prepare(),/mail_encryption_key_lost/);assert.equal(f.values.has(RAW_KEY_NAME),false);assert.deepEqual(await readFile(file),before);
 const other=new PersonalMail({storageRoot:path.join(f.root,'locked-state')},{personalRoot:path.join(f.root,'locked-mail')});other.autoWiki=false;
 try{await assert.rejects(other.intake({mails:[{raw,uidl:'x'}]},other.generation,{collectOnly:true,accountId:'fixture'}),/mail_encryption_unavailable/);assert.equal(other.rows().length,0);}finally{other.dispose();await other.rawDisposed;}
});
test('tampering and swapping originals across mail IDs fail authentication; conflicting plaintext is preserved',async t=>{
 const f=await fixture(t),row=await f.import(),file=path.join(f.mail.rawRoot,row.id,'message.eml'),sealed=await readFile(file+'.enc');
 const changed=Buffer.from(sealed);changed[changed.length-1]^=1;await writeFile(file+'.enc',changed);await assert.rejects(f.mail.read(row.id),/mail_encryption_integrity/);
 await writeFile(file+'.enc',sealed);await writeFile(file,'conflicting original');await assert.rejects(f.mail.rawVault.read(file),/mail_source_changed/);assert.equal(await readFile(file,'utf8'),'conflicting original');await rm(file);
 const other=path.join(f.mail.rawRoot,'b'.repeat(64));await mkdir(other);await copyFile(file+'.enc',path.join(other,'message.eml.enc'));await assert.rejects(f.mail.rawVault.read(path.join(other,'message.eml')),/mail_encryption_integrity/);
});
test('binary envelope preserves bytes and rejects a wrong key or truncated tag',()=>{
 const key=randomBytes(32),body=randomBytes(10000),aad=Buffer.from('source/message.eml'),sealed=encryptRaw(key,body,aad);assert.deepEqual(decryptRaw(key,sealed,aad),body);assert.throws(()=>decryptRaw(randomBytes(32),sealed,aad),/mail_encryption_integrity/);assert.throws(()=>decryptRaw(key,sealed.subarray(0,20),aad),/mail_encryption_integrity/);
});
test('failed migration write keeps the plaintext source and explicit retry finishes without refetching',async t=>{
 const f=await fixture(t),row=await f.import(),file=path.join(f.mail.rawRoot,row.id,'message.eml');await writeFile(file,raw);await rm(file+'.enc');
 const persist=f.mail.rawVault.persist.bind(f.mail.rawVault);f.mail.rawVault.persist=async()=>{throw Object.assign(Error('full'),{code:'ENOSPC'});};
 await assert.rejects(f.mail.rawVault.migrate(()=>f.mail.rows()),/full/);assert.deepEqual(await readFile(file),raw);assert.equal(f.mail.rawVault.progress.state,'failed');
 f.mail.rawVault.persist=persist;await f.mail.call({action:'retry'});assert.equal(f.mail.rawVault.progress.state,'completed');await assert.rejects(stat(file),{code:'ENOENT'});assert.deepEqual(await f.mail.rawVault.read(file),raw);
});
