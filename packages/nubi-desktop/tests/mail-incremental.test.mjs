import test from 'node:test';
import assert from 'node:assert/strict';
import {MailPortal} from '../electron-app/mail-portal.cjs';

function fixture(known=new Set()){
 const calls=[],imports=[];let rows=[3,2,1],fail=false;
 const host=new MailPortal({invoke:async(_method,args)=>{
  if(args.action==='portalKnown')return {uids:[...known]};
  if(args.action==='portalImport'){imports.push(args.uid);if(fail)throw Error('mail_parse_failed');known.add(args.uid);}
  return {};
 }});
 host.state.connected=true;host.identity={setCd:''};
 host.read=async(operation,input={})=>{
  calls.push({operation,...input});
  if(operation==='folders')return [{folderID:1,folderName:'받은메일함',mailCount:rows.length}];
  if(operation==='list')return {liteHeaderVOs:rows.map(mailSeq=>({mailSeq}))};
  if(operation==='summary')return {subject:'Synthetic mail'};
  if(operation==='eml')return {raw:'bWFpbA==',size:4};
  assert.fail(operation);
 };
 return {host,calls,imports,known,setRows:value=>rows=value,fail:value=>fail=value};
}

test('server checks fetch bodies only for unknown IDs, including after restart and overlapping requests',async t=>{
 const f=fixture(new Set(['portal:1:2','portal:1:1']));t.after(()=>f.host.dispose());
 const first=f.host.sync(),overlap=f.host.sync({manual:true});assert.equal(first,overlap);await first;
 assert.deepEqual(f.imports,['portal:1:3']);
 await f.host.sync({manual:true});
 assert.equal(f.calls.filter(c=>c.operation==='summary').length,1);
 assert.equal(f.calls.filter(c=>c.operation==='eml').length,1);
 // Discover an older missing item too: a known first page must not hide gaps.
 f.setRows([4,3,2,1,0]);await f.host.sync();
 assert.deepEqual(f.imports,['portal:1:3','portal:1:4','portal:1:0']);
 const restarted=fixture(f.known);t.after(()=>restarted.host.dispose());await restarted.host.sync();
 assert.equal(restarted.calls.filter(c=>['summary','eml'].includes(c.operation)).length,0);
});

test('failed new imports remain eligible for retry without downloading saved mail again',async t=>{
 const f=fixture(new Set(['portal:1:2','portal:1:1']));t.after(()=>f.host.dispose());
 f.fail(true);await f.host.sync();assert(!f.known.has('portal:1:3'));
 f.fail(false);await f.host.sync();assert(f.known.has('portal:1:3'));
 assert.deepEqual(f.calls.filter(c=>c.operation==='eml').map(c=>c.seq),['3','3']);
});

test('automatic collection waits five minutes, imports only arrivals, and stops on disconnect',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const f=fixture();t.after(()=>f.host.dispose());
 const checks=()=>f.calls.filter(c=>c.operation==='folders').length;
 await f.host.sync();assert.equal(checks(),1);
 f.setRows([4,3,2,1]);
 t.mock.timers.tick(299999);assert.equal(checks(),1);
 t.mock.timers.tick(1);await f.host.syncing;
 assert.equal(checks(),2);assert.deepEqual(f.imports,['portal:1:3','portal:1:2','portal:1:1','portal:1:4']);
 // A manual check replaces the scheduled check instead of creating another loop.
 t.mock.timers.tick(60000);await f.host.recheck();assert.equal(checks(),3);
 t.mock.timers.tick(299999);assert.equal(checks(),3);
 t.mock.timers.tick(1);await f.host.syncing;assert.equal(checks(),4);
 assert.equal(f.imports.length,4);
 await f.host.disconnect();t.mock.timers.tick(600000);assert.equal(checks(),4);
});
