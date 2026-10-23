import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createKnoxNativeReader,createKnoxEvidenceStore,readKnoxWindow,normalizeKnoxJsmIssue,knoxProcessFlow} from '../runtime/knox-knowledge.mjs';
import {PersonalMail} from './helpers-personal-mail.mjs';

test('native Knox mail reuses real mysingle import, PersonalMail parser, original hash and vault',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'knox-node-')),input=path.join(root,'source','AUTO_INBOX');await mkdir(input,{recursive:true});
  const mail=new PersonalMail({storageRoot:path.join(root,'state')},{personalRoot:path.join(root,'personal'),pull:()=>assert.fail('no mail network')});
  t.after(async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true});});
  const raw=Buffer.from('X-DESTTOP-MSG-UNIQUEID: native-test\r\nSubject: Knox review\r\nFrom: a@example.test\r\nTo: b@example.test\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n금요일 검토');
  await writeFile(path.join(input,'mail.mysingle'),raw);await mail.call({action:'setAutoWiki',enabled:false});
  await mail.startFolderImport(path.dirname(input));await mail.importTask;
  const reader=createKnoxNativeReader({sourceId:'profile-1',mail});
  const result=await reader.read({stream:'mail',limit:10});
  assert.equal(result.records.length,1);assert.equal(result.records[0].data.text,'금요일 검토');
  assert.equal(result.records[0].sourceHash,mail.rows()[0].sourceHash);
  assert.equal(result.records[0].data.attachmentContent,'not-read');assert.equal(result.coverage.kind,'native-mail-store');
});

const binding={id:'selected-window',hwnd:123,processId:12,processName:'KnoxTeams',windowTitle:'Knox Teams',room:'업무'};
test('reads only the bound UIA window and explicitly keeps visible text partial',async()=>{
  const calls=[];const computer={status:async hwnd=>{calls.push(['status',hwnd]);return {...binding};},inspect:async hwnd=>{calls.push(['inspect',hwnd]);return {elements:[{name:'화면의 대화'},{name:'화면 밖',isOffscreen:true},{name:'비밀',isPassword:true}],coverage:{complete:false},truncated:true};},act:()=>assert.fail('no UI input')};
  const result=await readKnoxWindow(computer,binding,'chat');
  assert.equal(result.records[0].data.text,'화면의 대화');assert.equal(result.records[0].data.partial,true);
  assert.equal(result.coverage.complete,false);assert.deepEqual(calls.map(call=>call[0]),['status','inspect','status']);
});
test('rejects the wrong app, changed window and out-of-scope room without actions',async()=>{
  const computer={status:async()=>({...binding,processId:99}),inspect:()=>assert.fail('changed binding')};
  await assert.rejects(readKnoxWindow(computer,binding,'chat'),/knox_binding_changed/);
  await assert.rejects(readKnoxWindow(computer,{...binding,processName:'notepad'},'chat'),/knox_binding_required/);
  const reader=createKnoxNativeReader({sourceId:'profile',computer,windows:{chat:binding}});
  await assert.rejects(reader.read({stream:'chat',limit:10,rooms:['다른 방']}),/knox_room_scope/);
});
test('memo values use only observed editor IDs through the existing native value reader',async()=>{
  const memo={...binding,processName:'mySingle.DesktopMemo',windowTitle:'Memo'},calls=[];
  const computer={status:()=>Promise.resolve({...memo}),inspect:()=>Promise.resolve({elements:[{selector:'txtTitle',name:'제목'},{selector:'txtMessage',name:'본문'}]}),
    value:(_window,selector)=>{calls.push(selector);return Promise.resolve(selector==='txtTitle'?'회의':'검토 내용');}};
  const result=await readKnoxWindow(computer,memo,'memo');assert.equal(result.records[0].data.body,'검토 내용');assert.equal(result.records[0].data.partial,true);
  assert.deepEqual(calls,['txtTitle','txtMessage','txtTitle']);
  computer.inspect=()=>Promise.resolve({elements:[{selector:'other',name:'목록 미리보기'}]});calls.length=0;
  const partial=await readKnoxWindow(computer,memo,'memo');assert.equal(partial.records[0].data.body,undefined);assert.deepEqual(calls,[]);
});
test('native JSM normalization preserves partial comments, classification, links and no attachment body',async()=>{
  const issue={key:'WORK-7',fields:{summary:'장애 조치',description:'h2. 원인\n{code}진단{code}',customfield_10825:['서비스 (CMDB-1)'],comment:{total:5,comments:[{id:'1',body:'검토 [자료|https://example.test]',author:{displayName:'담당자'}}]},attachment:[{id:'8',filename:'보고.docx',size:123,content:'not copied'}],issuelinks:[{type:{name:'Task Link',outward:'작업'},outwardIssue:{key:'WORK-8',fields:{summary:'후속 작업'}}}]},changelog:{total:2,histories:[{items:[{field:'password',toString:'never copied'},{field:'status',toString:'검토'}]}]}};
  const normal=normalizeKnoxJsmIssue(issue);assert.equal(normal.service.key,'CMDB-1');assert.equal(normal.comments.length,1);assert.equal(normal.commentCoverage.total,5);
  assert.equal(normal.history.length,1);assert.equal(normal.sourceUrl,null);assert.equal(normal.links[0].key,'WORK-8');assert(!JSON.stringify(normal).includes('never copied'));assert(!JSON.stringify(normal).includes('not copied'));
  const reader=createKnoxNativeReader({sourceId:'profile',jsm:{listCachedIssues:async()=>({issues:[issue],total:20,truncated:true})}});
  const result=await reader.read({stream:'jsm',limit:2,projects:['WORK']});assert.equal(result.coverage.liveRefresh,false);assert.equal(result.records[0].data.key,'WORK-7');
});
test('mail source changes fail before publication and source capabilities do not fall back to servers',async()=>{
  const reader=createKnoxNativeReader({sourceId:'profile',mail:{searchMail:async()=>({results:[{id:'one',sourceHash:'a'}]}),read:async()=>({id:'one',sourceHash:'b',mail:{}})}});
  await assert.rejects(reader.read({stream:'mail',limit:1}),/knox_mail_changed/);
  const absent=createKnoxNativeReader({sourceId:'profile'});
  for(const stream of ['mail','chat','memo','jsm','ask'])await assert.rejects(absent.read({stream,limit:1}));
});
test('question history uses existing run/question bindings and never becomes execution approval',async()=>{
  const reader=createKnoxNativeReader({sourceId:'profile',questions:{listRecorded:async()=>({items:[{id:'question',runId:'run-1',answer:'예',authorization:'approved'}]})}});
  const result=await reader.read({stream:'ask',limit:1});assert.equal(result.records[0].data.authorization,'historical-record-only');assert.equal(result.records[0].data.executionVerified,false);
});
test('native evidence reuses encrypted storage, restores readback and wipes its session copy on dispose',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'knox-vault-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const values=new Map(),secrets={get:async key=>values.get(key),set:async(key,value)=>values.set(key,value)};
  const options={rawDirectory:path.join(root,'raw'),storeDirectory:path.join(root,'encrypted'),secrets};
  const store=createKnoxEvidenceStore(options);
  const file=await store.write({runId:'run-1',stream:'mail',data:{text:'메일 본문'}});
  assert.match(await readFile(file,'utf8'),/메일 본문/);
  const names=await readdir(options.storeDirectory);assert(names.every(name=>name.endsWith('.enc')));
  assert(!Buffer.concat(await Promise.all(names.map(name=>readFile(path.join(options.storeDirectory,name))))).includes(Buffer.from('메일 본문')));
  await store.dispose();await assert.rejects(readFile(file));
  const reopened=createKnoxEvidenceStore(options);await reopened.write({runId:'run-2',stream:'memo',data:{text:'다음 자료'}});
  assert.match(await readFile(file,'utf8'),/메일 본문/);await reopened.dispose();
  await assert.rejects(reopened.write({runId:'late',stream:'mail',data:{}}),/knox_evidence_closed/);
});
test('missing OS vault fails closed without leaving a plain evidence file',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'knox-vault-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const store=createKnoxEvidenceStore({rawDirectory:path.join(root,'raw'),storeDirectory:path.join(root,'encrypted')});
  await assert.rejects(store.write({runId:'run',stream:'mail',data:{text:'private'}}),/knox_evidence_vault/);
  await assert.rejects(readdir(path.join(root,'raw')));await store.dispose();
  assert.throws(()=>createKnoxEvidenceStore({rawDirectory:root,storeDirectory:path.join(root,'nested')}),/knox_evidence_directory/);
});
test('native process links preserve direction and bound graph traversal without fetching other tickets',()=>{
  const tickets=Array.from({length:100},(_,index)=>({key:'WORK-'+index,type:'Dev Task',links:index<99?[{key:'WORK-'+(index+1),type:'Task Link',direction:'out'}]:[]}));
  const flow=knoxProcessFlow(tickets,'WORK-0');assert.equal(flow.nodes.length,6);assert.deepEqual(flow.edges[0],{from:'WORK-0',to:'WORK-1',type:'Task Link'});assert.equal(flow.coverage.complete,false);
  tickets[0].links=tickets.slice(1).map(ticket=>({key:ticket.key,type:'Task Link',direction:'in'}));
  const wide=knoxProcessFlow(tickets,'WORK-0');assert.equal(wide.nodes.length,80);assert(wide.edges.every(edge=>wide.nodes.some(node=>node.key===edge.from)&&wide.nodes.some(node=>node.key===edge.to)));
});
