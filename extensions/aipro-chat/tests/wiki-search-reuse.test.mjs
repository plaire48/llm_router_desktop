import test from 'node:test';
import assert from 'node:assert/strict';
import {createWikiQuestionSearch} from '../openwiki-retrieval.js';

const doc=(id,text,title=id)=>({id,title,text});
test('an exact error code does not return a different code sharing its words',()=>{
 const search=createWikiQuestionSearch(),docs=[doc('timeout','# Timeout\nERR_AUTH_TIMEOUT requires a lease reset.'),doc('failed','# Failure\nERR_AUTH_FAILED requires approval.')];
 assert.deepEqual(search('ERR_AUTH_TIMEOUT',docs).map(hit=>hit.documentId),['timeout']);
 assert.deepEqual(search('ERR_AUTH_UNKNOWN',docs),[]);
});
test('follow-up queries reuse the same snapshot index while keeping exact source offsets',()=>{
 const search=createWikiQuestionSearch(),docs=[doc('policy','# 휴가\n휴가 **신청**은 18일입니다.'),doc('retry','# Retry\nQUARTZ_RETRY waits 30 seconds.')];
 assert.equal(search('휴가신청',docs)[0].documentId,'policy');
 const hits=search('QUARTZ_RETRY',docs.map(d=>({...d})));
 assert.equal(hits[0].documentId,'retry');assert.equal(docs[1].text.slice(hits[0].start,hits[0].end),docs[1].text);
 assert.equal(search.diagnostics().indexBuilds,1);assert.equal(search.diagnostics().indexReuses,1);
});
test('changed text, title and authorized subset invalidate ranking together without leaking old pages',()=>{
 const search=createWikiQuestionSearch(),first=doc('one','# OLDHEADER\noldtoken'),second=doc('two','# Other\nothertoken');
 assert(search('oldtoken',[first,second]).length);
 const current=doc('one','# NEWHEADER\nnewtoken','renamedtitle');
 assert.deepEqual(search('oldtoken',[current]),[]);assert.deepEqual(search('othertoken',[current]),[]);
 assert(search('renamedtitle',[current]).length);assert(search('newtoken',[current]).length);
 assert.equal(search.diagnostics().retainedDocuments,1);assert.equal(search.diagnostics().indexBuilds,2);
 assert(search.context(current,0,current.text.length).ranges.every(r=>!current.text.slice(r.start,r.end).includes('OLDHEADER')));
});
