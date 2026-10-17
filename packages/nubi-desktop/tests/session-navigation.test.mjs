import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSession, groupSessionsByDate, openSession, restoreSessionNavigation, saveSessionNavigation, sessionSidebarGroups} from '../ui/session-navigation.mjs';

test('open tabs persist per project, discard stale IDs and closing never deletes a task', () => {
  const values = new Map(), storage = {getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value)};
  const tasks = [{id:'one'}, {id:'two'}];
  saveSessionNavigation('project-a', ['one','two','removed'], 'two', storage);
  assert.deepEqual(restoreSessionNavigation('project-a',tasks,storage),{tabs:['one','two'],selected:'two'});
  assert.deepEqual(restoreSessionNavigation('project-b',tasks,storage),{tabs:[],selected:null});
  assert.deepEqual(openSession(['one'],'two'),['one','two']);
  assert.deepEqual(closeSession(['one','two'],'two','two'),{tabs:['one'],selected:'one'});
  assert.deepEqual(tasks,[{id:'one'},{id:'two'}]);
  values.set('nubi-session-tabs-v1:project-a','{broken');
  assert.deepEqual(restoreSessionNavigation('project-a',tasks,storage),{tabs:[],selected:null});
});

test('history groups sessions by local day without changing their stored order', () => {
  const today = new Date(2026,8,25,13), yesterday = new Date(2026,8,24,10), older = new Date(2026,7,2,9);
  const tasks = [{id:'old',createdAt:older.toISOString()},{id:'today',createdAt:today.toISOString()},{id:'yesterday',createdAt:yesterday.toISOString()}];
  const groups = groupSessionsByDate(tasks,today);
  assert.deepEqual(groups.map(group => [group.label,group.tasks.map(task => task.id)]),[['오늘',['today']],['어제',['yesterday']],['2026년 8월 2일',['old']]]);
  assert.equal(tasks[0].id,'old');
});

test('pins precede every date group in pin order, independently of conversation activity',()=>{
  const now=new Date(2026,9,17,12),today=now.toISOString(),old=new Date(2026,8,1,12).toISOString();
  const tasks=[{id:'new',createdAt:today},{id:'first-pin',createdAt:today},{id:'last-pin',createdAt:old}];
  const groups=sessionSidebarGroups(tasks,['last-pin','first-pin'],{now}).groups;
  assert.deepEqual(groups.map(group=>[group.label,group.tasks.map(task=>task.id)]),[['고정',['last-pin','first-pin']],['오늘',['new']]]);
  assert.deepEqual(tasks.map(task=>task.id),['new','first-pin','last-pin']);
  const unpinned=sessionSidebarGroups(tasks,['last-pin'],{now}).groups;
  assert.deepEqual(unpinned.map(group=>group.tasks.map(task=>task.id)),[['last-pin'],['new','first-pin']]);
});

test('all pins stay visible above the recent limit; stale IDs do not consume history slots',()=>{
  const now=new Date(2026,9,17,12),tasks=Array.from({length:12},(_,i)=>({id:String(i),createdAt:new Date(now.getTime()-i*1000).toISOString()}));
  const pins=['missing',...tasks.slice(5).map(task=>task.id)],short=sessionSidebarGroups(tasks,pins,{limit:3,now});
  assert.equal(short.groups[0].tasks.length,7);assert.equal(short.hiddenCount,2);assert.equal(short.canCollapse,false);
  assert.deepEqual(short.groups[1].tasks.map(task=>task.id),['0','1','2']);
  const full=sessionSidebarGroups(tasks,pins,{showAll:true,limit:3,now});
  assert.equal(full.hiddenCount,0);assert.equal(full.canCollapse,true);assert.equal(full.groups.flatMap(group=>group.tasks).length,12);
});
