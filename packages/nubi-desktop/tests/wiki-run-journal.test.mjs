import test from 'node:test';import assert from 'node:assert/strict';
import {createWikiRunJournal} from '../runtime/wiki-run-journal.mjs';
test('Wiki journal preserves the wall deadline and the one continuation across reopening',()=>{
 const records=new Map(),store={get:key=>records.get(key),set:(key,value)=>records.set(key,structuredClone(value))};let now=1000;
 const options={store,key:'wiki:test',identity:{root:'owned',model:'one'},clock:{now:()=>now}};
 const first=createWikiRunJournal(options),deadline=first.value.deadlineAt;
 assert.equal(first.continuation('/openwiki/a.md'),true);now+=60000;
 const second=createWikiRunJournal(options);assert.equal(second.value.deadlineAt,deadline);assert.equal(second.continuation('/openwiki/a.md'),false);
 let live=true;const guarded=createWikiRunJournal({...options,check:()=>{if(!live)throw Error('project_changed');}});live=false;
 assert.throws(()=>guarded.snapshot({runId:'old',phase:'partial',pages:[]}),/project_changed/);
});
test('a completed Wiki page clears stale retry UI without exposing the raw provider error',()=>{
 const values=new Map(),store={get:key=>values.get(key),set:(key,value)=>values.set(key,structuredClone(value))};
 const journal=createWikiRunJournal({store,key:'wiki:test',identity:{root:'owned'}});
 journal.retry('/openwiki/a.md',Error('private url and secret'),1,Date.now()+10000);
 journal.snapshot({runId:'one',phase:'ready',pages:[{id:'page',path:'/openwiki/a.md',status:'complete'}]});
 assert.equal(journal.value.pages['/openwiki/a.md'].state,'done');assert.equal(journal.value.pages['/openwiki/a.md'].error,null);assert.equal(journal.value.pages['/openwiki/a.md'].nextRetryAt,null);
 assert.doesNotMatch(JSON.stringify(journal.value),/private url and secret/);
});

test('page journal distinguishes queued work from the active worker and keeps concurrent workers visible',()=>{
 const values=new Map(),store={get:key=>values.get(key),set:(key,value)=>values.set(key,structuredClone(value))};
 const journal=createWikiRunJournal({store,key:'wiki:queue',identity:{root:'owned'}}),pages=['a','b','c'].map(id=>({id,path:'/openwiki/'+id+'.md',status:'pending'}));
 journal.snapshot({runId:'one',phase:'resumed',pages});assert(Object.values(journal.value.pages).every(page=>page.state==='pending'));
 journal.snapshot({runId:'one',phase:'page_running',page:pages[0].path,pages});journal.snapshot({runId:'one',phase:'page_running',page:pages[1].path,pages});
 assert.equal(journal.value.pages[pages[0].path].state,'running');assert.equal(journal.value.pages[pages[1].path].state,'running');assert.equal(journal.value.pages[pages[2].path].state,'pending');
});

test('completed host rounds advance without resetting the wall budget or accepting a late prior round',()=>{
 const values=new Map(),store={get:key=>values.get(key),set:(key,value)=>values.set(key,structuredClone(value))};let now=1000;
 const options={store,key:'wiki:rounds',identity:{root:'owned'},clock:{now:()=>now}};
 const first=createWikiRunJournal({...options,generation:'round:1'}),deadline=first.value.deadlineAt;
 first.continuation('/openwiki/a.md');first.snapshot({runId:'first',phase:'ready',pages:[]});now+=60000;
 const second=createWikiRunJournal({...options,generation:'round:2'});
 second.snapshot({runId:'second',phase:'partial',pages:[]});assert.equal(second.value.deadlineAt,deadline);
 assert.equal(second.continuation('/openwiki/a.md'),true,'a new approved round has its own continuation');
 assert.throws(()=>first.beat(),/wiki_run_changed/,'late prior owners cannot overwrite the next round');
 assert.throws(()=>createWikiRunJournal({...options,generation:'round:3'}),/wiki_run_changed/,'unfinished rounds cannot be replaced');
 const reopened=createWikiRunJournal({...options,generation:'round:2'});
 assert.equal(reopened.continuation('/openwiki/a.md'),false);assert.equal(reopened.value.deadlineAt,deadline);
 assert.throws(()=>reopened.snapshot({runId:'unrelated',phase:'ready',pages:[]}),/wiki_run_changed/);
});
