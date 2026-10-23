import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {readSource} from '../runtime/files.mjs';
import {normalizePortalMail} from '../runtime/mail-portal-content.mjs';
import {parsePop3Content} from '../../openwiki/src/connectors/sources/pop3-content.mjs';

test('multi-MiB sources are readable and explicit smaller read budgets still reject them',async t=>{
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'large-source-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const content='// 설명\n'.repeat(250000)+'// TailNeedle: 승인 조건\n';await writeFile(path.join(root,'large.ts'),content);
 assert((await readSource(root,'large.ts')).content.endsWith('// TailNeedle: 승인 조건\n'));
 await assert.rejects(readSource(root,'large.ts',{maxBytes:1024}),/file_too_large/);
});
test('large MIME body keeps late corrections within an explicit extraction budget',async()=>{
 const body='본 검토는 예비 내용입니다.\r\n'.repeat(18000)+'정정: 최종 승인은 보류되었습니다.';
 const raw=Buffer.from('From: fixture@example.test\r\nSubject: scale fixture\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n'+body);
 const parsed=await parsePop3Content(raw);assert(parsed.text.includes('최종 승인은 보류'));
 const {normalized:mail}=await normalizePortalMail(raw,{bodyLimit:8_000_000});assert(mail.text.includes('최종 승인은 보류'));assert.equal(mail.truncated,false);
});
test('large existing Wiki pages survive the update snapshot instead of failing above one MiB',async t=>{
 const {mkdir}=await import('node:fs/promises'),{wikiFiles}=await import('../runtime/wiki-snapshot.mjs');const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'large-existing-wiki-')));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'openwiki'));const content='# 운영\n'+'참고 설명\n'.repeat(100000)+'정정: 승인 보류';await writeFile(path.join(root,'openwiki','large.md'),content);const files=await wikiFiles(root);assert.equal(files[0].content,content);
});
