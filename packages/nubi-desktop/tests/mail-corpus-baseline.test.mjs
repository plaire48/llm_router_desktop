import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {corpusOptions, mailRecord, corpusQuestions, writeCorpus} from '../eval/mail-corpus/generate.mjs';

test('mail corpus defaults describe 300k messages, 20k threads and 500 synthetic senders', () => {
  assert.deepEqual(corpusOptions(), {count:300000, threads:20000, people:500, seed:21});
  for (const bad of [{count:0},{threads:300001},{people:0},{seed:NaN},{count:1.2}])
    assert.throws(() => corpusOptions(bad), /corpus_options/);
});
test('synthetic mail is repeatable, source hashed and contains reply and attachment metadata', () => {
  const options=corpusOptions({count:60,threads:4,people:5});
  const first=mailRecord(0,options), reply=mailRecord(4,options);
  assert.deepEqual(first,mailRecord(0,options));
  assert.notEqual(first.row.sourceHash,mailRecord(0,{...options,seed:22}).row.sourceHash);
  assert.equal(first.threadId,reply.threadId);
  assert.equal(reply.mail.inReplyTo,first.mail.messageId);
  assert.equal(first.mail.attachments[0].contentState,'metadata_only');
  assert.match(first.mail.from, /@example\.invalid>/);
  assert.throws(()=>mailRecord(60,options),/corpus_index/);
});
test('full corpus identity spans all threads, people, two languages and ten calendar years', () => {
  const options=corpusOptions(), threads=new Set(), people=new Set(), years=new Set(), languages=new Set();
  // Every thread root covers every identity and date bucket; no 300k allocation in CI.
  for(let i=0;i<options.threads;i++){
    const row=mailRecord(i,options);
    threads.add(row.threadId);people.add(row.mail.from);people.add(row.mail.to);
    years.add(row.mail.date.slice(0,4));languages.add(row.language);
  }
  assert.equal(threads.size,20000);assert.equal(people.size,500);assert.equal(years.size,10);assert.equal(languages.size,2);
});
test('240 questions have source-bound oracles, balanced classes and deliberate absent queries', () => {
  const options=corpusOptions(), questions=corpusQuestions(options);
  assert.equal(questions.length,240);
  for(const kind of ['message','thread','body','attachment','metadata','absent'])
    assert.equal(questions.filter(q=>q.kind===kind).length,40);
  for(const q of questions){
    assert.equal(q.expectedIds.length===0,q.kind==='absent');
    for(const id of q.expectedIds) assert.match(id,/^m\d{6}$/);
  }
});
test('stream writer preserves exact bytes and refuses an existing corpus rather than overwriting it', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-corpus-test-'));
  try{
    const options={count:60,threads:4,people:5}, a=await writeCorpus(path.join(root,'a'),options), b=await writeCorpus(path.join(root,'b'),options);
    assert.equal(a.sha256,b.sha256);assert.equal(a.count,60);
    assert.equal((await readFile(path.join(root,'a/mail.jsonl'),'utf8')).trim().split('\n').length,60);
    await assert.rejects(writeCorpus(path.join(root,'a'),options),/EEXIST/);
  }finally{await rm(root,{recursive:true,force:true});}
});
