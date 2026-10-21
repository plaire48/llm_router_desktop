import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,realpath,rm,truncate,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {PersonalMail} from './helpers-personal-mail.mjs';
import {scanMailFolder} from '../runtime/mail-file-import.mjs';
const eml=value=>Buffer.from('Subject: Resume\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n'+value);
const sha=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t){
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-mail-resume-'))),input=path.join(root,'input');await mkdir(input);
 const host={storageRoot:path.join(root,'state')},options={personalRoot:path.join(root,'mail')};let mail=new PersonalMail(host,options);await mail.call({action:'setAutoWiki',enabled:false});
 t.after(async()=>{mail.importController?.abort();await mail.importTask;await mail.dispose();await rm(root,{recursive:true,force:true});});
 return {root,input,get mail(){return mail;},async restart(){mail.dispose();await mail.importTask;mail=new PersonalMail(host,options);return mail;}};
}
test('resume after app exit skips completed MIME reads, retries remaining and changed files',async t=>{
 const f=await fixture(t);for(let i=0;i<4;i++)await writeFile(path.join(f.input,i+'.eml'),eml('body '+i));
 const parse=f.mail.parsePortal.bind(f.mail);let calls=0;
 f.mail.parsePortal=async(...args)=>{if(++calls===3){f.mail.dispose();throw Error('mail_cancelled');}return parse(...args);};
 await f.mail.startFolderImport(f.input);await f.mail.importTask;await f.restart();
 assert.equal(f.mail.rows().length,2);assert.equal(f.mail.status().localImport.state,'interrupted');assert.equal(f.mail.status().localImport.completed,2);
 let resumedCalls=0;const resumedParse=f.mail.parsePortal.bind(f.mail);f.mail.parsePortal=(...args)=>{resumedCalls++;return resumedParse(...args);};
 await f.mail.call({action:'resumeImport'});await f.mail.importTask;
 assert.equal(resumedCalls,2);assert.equal(f.mail.rows().length,4);assert.equal(f.mail.status().localImport.resumed,2);
 await writeFile(path.join(f.input,'0.eml'),eml('changed source'));
 await f.mail.call({action:'resumeImport'});await f.mail.importTask;
 assert.equal(resumedCalls,3);assert.equal(f.mail.rows().length,5);assert.equal(f.mail.status().localImport.resumed,3);
});
test('cancelled parser terminates promptly and resume retries that file',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.input,'one.eml'),eml('body'));
 const parse=f.mail.parsePortal.bind(f.mail);f.mail.parsePortal=(raw,options)=>{setTimeout(()=>f.mail.call({action:'cancelImport'}),1);return parse(raw,options);};
 const start=Date.now();await f.mail.startFolderImport(f.input);await f.mail.importTask;
 assert(Date.now()-start<3000);assert.equal(f.mail.status().localImport.state,'cancelled');assert.equal(f.mail.status().localImport.completed,0);assert.equal(f.mail.rows().length,0);
 f.mail.parsePortal=parse;await f.mail.call({action:'resumeImport'});await f.mail.importTask;assert.equal(f.mail.rows().length,1);
});
test('disk full pauses remaining work and retry preserves the completed queue',async t=>{
 const f=await fixture(t);for(let i=0;i<3;i++)await writeFile(path.join(f.input,i+'.eml'),eml('body '+i));
 const intake=f.mail.intake.bind(f.mail);let calls=0;f.mail.intake=(...args)=>{if(++calls===2)throw Object.assign(Error('disk full'),{code:'ENOSPC'});return intake(...args);};
 await f.mail.startFolderImport(f.input);await f.mail.importTask;assert.equal(f.mail.status().localImport.error,'mail_storage_full');assert.equal(f.mail.rows().length,1);
 f.mail.intake=intake;await f.mail.call({action:'resumeImport'});await f.mail.importTask;assert.equal(f.mail.rows().length,3);assert.equal(f.mail.status().localImport.resumed,1);
});
test('stale staging bytes from a killed process are replaced without damaging originals',async t=>{
 const f=await fixture(t),raw=eml('complete body'),uid=sha(Buffer.concat([Buffer.from('other\0'),raw])),id=sha(sha('nubi-local-mail-files-v1')+'\0'+uid);
 await writeFile(path.join(f.input,'one.eml'),raw);await f.mail.prepare();const pending=path.join(f.mail.rawRoot,'.'+id+'.pending');await mkdir(pending);await writeFile(path.join(pending,'message.eml'),'half written');
 await f.mail.startFolderImport(f.input);await f.mail.importTask;
 assert.equal(f.mail.rows().length,1);assert.deepEqual(await f.mail.rawVault.read(path.join(f.mail.rawRoot,id,'message.eml')),raw);assert(!(await readdir(f.mail.rawRoot)).includes('.'+id+'.pending'));
});
test('folder inventory exceeds 20,000 messages and 4 GiB without a folder cap',async t=>{
 const f=await fixture(t);for(let offset=0;offset<20005;offset+=100)await Promise.all(Array.from({length:Math.min(100,20005-offset)},(_,n)=>writeFile(path.join(f.input,(offset+n)+'.eml'),eml('small'))));
 for(let n=0;n<180;n++){const file=path.join(f.input,'large-'+n+'.eml');await writeFile(file,eml('sparse scan only'));await truncate(file,30*1024*1024);}
 const scan=await scanMailFolder(f.input);assert.equal(scan.files.length,20185);assert.equal(scan.failures.length,0);assert(scan.files.reduce((total,file)=>total+Math.min(file.size,24*1024*1024),0)>4*1024*1024*1024);
});
test('a completed disk write without a queue receipt is recovered on retry',async t=>{
 const f=await fixture(t),raw=eml('persisted before record');await writeFile(path.join(f.input,'one.eml'),raw);
 const set=f.mail.store.set.bind(f.mail.store);let fail=true;
 f.mail.store.set=(key,value)=>{if(fail&&key.startsWith('mail:')){fail=false;throw Error('fixture_record_interrupted');}return set(key,value);};
 await f.mail.startFolderImport(f.input);await f.mail.importTask;assert.equal(f.mail.rows().length,0);
 const [id]=(await readdir(f.mail.rawRoot)).filter(name=>!name.startsWith('.'));assert.match(id,/^[a-f0-9]{64}$/);assert.deepEqual(await f.mail.rawVault.read(path.join(f.mail.rawRoot,id,'message.eml')),raw);
 await f.mail.call({action:'resumeImport'});await f.mail.importTask;assert.equal(f.mail.rows().length,1);assert.equal(f.mail.status().localImport.imported,1);assert.deepEqual(await f.mail.rawVault.read(path.join(f.mail.rawRoot,id,'message.eml')),raw);
});
