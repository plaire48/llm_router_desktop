import {mkdtemp, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHmac} from 'node:crypto';
import {expect, test} from 'vitest';
import {createPersistentWikiIndex} from '../../src/retrieval/persistent.js';

test('disk retrieval survives restart and updates only the changed document', async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'wiki-disk-'));
 try {
  const filename=path.join(root,'search.db');
  let index=await createPersistentWikiIndex({filename,namespace:'project:a'});
  index.replace({id:'a',version:'v1',scope:'module:a',units:[{id:'body',title:'달빛 승인',text:'검토를 통과해야 배포할 수 있습니다.',start:0,end:23}]});
  index.replace({id:'b',version:'v1',scope:'module:b',units:[{id:'body',title:'새벽 승인',text:'반려했습니다.',start:0,end:7}]});
  expect(index.search('달빛의 승인',{limit:1})[0]?.documentId).toBe('a');
  index.close();
  index=await createPersistentWikiIndex({filename,namespace:'project:a'});
  expect(index.version('a')).toBe('v1');
  expect(index.search('달빛',{limit:1})[0]?.documentId).toBe('a');
  index.replace({id:'a',version:'v2',scope:'module:a',units:[{id:'body',title:'달빛 일정',text:'납기는 금요일입니다.',start:0,end:11}]});
  expect(index.search('검토',{limit:5})).toEqual([]);
  expect(index.version('b')).toBe('v1');
  expect(index.search('금요일',{limit:5})[0]?.version).toBe('v2');
  index.remove('a');expect(index.search('달빛',{limit:5})).toEqual([]);
  index.close();
 } finally {await rm(root,{recursive:true,force:true});}
});

test('filters and document restrictions precede the candidate limit', async()=>{
 const index=await createPersistentWikiIndex({filename:':memory:',namespace:'scoped'});
 try {
  for(let i=0;i<80;i++)index.replace({id:'x'+i,version:'v',scope:i===79?'mine':'other',units:[{id:'body',title:'배포 승인',text:'승인 원문',start:0,end:5}]});
  expect(index.search('배포 승인',{scope:'mine',limit:1}).map(h=>h.documentId)).toEqual(['x79']);
  expect(index.search('배포',{documentIds:['x79'],limit:1}).map(h=>h.documentId)).toEqual(['x79']);
  expect(index.search('배포',{documentIds:[],limit:1})).toEqual([]);
 } finally {index.close();}
});

test('keyed tokens never write source words and a wrong key or namespace cannot reuse the index',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'wiki-private-'));
 const filename=path.join(root,'search.db'),encode=(word:string)=>createHmac('sha256','fixture-only-key').update(word).digest('hex');
 try{
  const index=await createPersistentWikiIndex({filename,namespace:'mail:fixture',encodeToken:encode,codecId:'fixture-key'});
  index.replace({id:'opaque-id',version:'opaque-hash',scope:'account-1',units:[{id:'body',title:'PrivateZephyr',text:'은밀한결정은 승인됐습니다.',start:0,end:16}]});
  expect(index.search('은밀한결정',{limit:5})[0]?.documentId).toBe('opaque-id');
  expect(index.search('PrivateZephyr',{limit:5})[0]?.documentId).toBe('opaque-id');
  index.close();
  const bytes=await readFile(filename);
  expect(bytes.includes(Buffer.from('PrivateZephyr'))).toBe(false);
  expect(bytes.includes(Buffer.from('은밀한결정'))).toBe(false);
  await expect(createPersistentWikiIndex({filename,namespace:'mail:other',encodeToken:encode,codecId:'fixture-key'})).rejects.toThrow('index_scope_changed');
  await expect(createPersistentWikiIndex({filename,namespace:'mail:fixture',encodeToken:encode,codecId:'wrong-key'})).rejects.toThrow('index_scope_changed');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('AND spans units of one document and Korean substrings remain searchable',async()=>{
 const index=await createPersistentWikiIndex({filename:':memory:',namespace:'mail'});
 try{
  index.replace({id:'a',version:'1',units:[{id:'subject',title:'Atlas',text:'Atlas 배포 일정',start:0,end:11},{id:'body',text:'승인되었습니다.',start:0,end:8}]});
  index.replace({id:'b',version:'1',units:[{id:'body',text:'Atlas 정보',start:0,end:8}]});
  expect([...new Set(index.search('Atlas 승인',{mode:'all',limit:5}).map(h=>h.documentId))]).toEqual(['a']);
 }finally{index.close();}
});

test('an exact code identifier cannot fall back to unrelated generic error prose',async()=>{
 const index=await createPersistentWikiIndex({filename:':memory:',namespace:'identifiers'});
 try{
  index.replace({id:'known',version:'1',units:[{id:'body',title:'known_error',text:'오류 처리 규칙입니다.',start:0,end:12}]});
  expect(index.search('unknown_error 처리',{strictAnchors:true,limit:5})).toEqual([]);
  expect(index.search('known_error 처리',{strictAnchors:true,limit:5})[0]?.documentId).toBe('known');
 }finally{index.close();}
});

test('mixed Korean and Latin words keep short AI terms without matching mail or storage',async()=>{
 const index=await createPersistentWikiIndex({filename:':memory:',namespace:'mixed',encodeToken:t=>createHmac('sha256','fixture').update(t).digest('hex'),codecId:'fixture'});
 try{
  index.replace({id:'wanted',version:'1',units:[{id:'body',text:'AI업무와 RAG강의 자료입니다.',start:0,end:20}]});
  index.replace({id:'other',version:'1',units:[{id:'body',text:'mail and Cloud Storage',start:0,end:22}]});
  expect(index.search('AI',{mode:'all',limit:5}).map(h=>h.documentId)).toEqual(['wanted']);
  expect(index.search('RAG',{mode:'all',limit:5}).map(h=>h.documentId)).toEqual(['wanted']);
 }finally{index.close();}
});

 test('strict anchors can rank a different detail unit in the anchored document',async()=>{
 const index=await createPersistentWikiIndex({filename:':memory:',namespace:'anchor-sections'});
 try{
  index.replace({id:'wanted',version:'1',units:[{id:'anchor',text:'exact_error',start:0,end:11},{id:'detail',text:'해결 조치와 승인 절차',start:12,end:26}]});
  index.replace({id:'noise',version:'1',units:[{id:'detail',text:'해결 조치와 승인 절차',start:0,end:14}]});
  const rows=index.search('exact_error 해결 조치 승인',{strictAnchors:true,limit:10});
  expect(rows.every(r=>r.documentId==='wanted')).toBe(true);expect(rows.some(r=>r.unitId==='detail')).toBe(true);
 }finally{index.close();}
 });
