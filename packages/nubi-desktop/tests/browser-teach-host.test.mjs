import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {scriptSlugFromTitle} from '../runtime/browser-teach-host.mjs';

// Browser teach plan T8 host connection (§8 답 32): record in the product browser → draft card → one-time trial →
// draft save → reviewed after inspected captures. Values stay in session memory; no engine or approval shortcut.
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const items=[{tag:'input',type:'text',role:'',name:'검색어',context:'검색어',editable:true,disabled:false,readOnly:false,sensitive:false},{tag:'button',type:'submit',role:'',name:'제출',context:'제출',editable:false,disabled:false,readOnly:false,sensitive:false}];
const page={url:'https://demo.invalid/form?q=1',title:'양식'};
const events=[{kind:'input',at:1,index:0,value:'누비',items,...page},{kind:'click',at:2,index:1,items,...page}];
const SNAPSHOT='- Page URL: https://demo.invalid/form\n### Snapshot\n- textbox "검색어" [ref=e1]\n- button "제출" [ref=e2]\n';

function wire(service,{events,capture=true}){
  const calls=[],requests=[];
  service.playwrightRequest=async(action,args={})=>{
    requests.push([action,args]);
    if(action==='tabs')return {tabs:[{tabId:'t1',documentId:'d1',title:'양식',url:page.url,active:true}]};
    if(action==='demonstration')return args.op==='stop'?{tabId:'t1',documentId:'d1',url:page.url,title:page.title,recording:false,events,dropped:1,reason:'stopped'}:{tabId:'t1',documentId:'d1',recording:true,events:0,dropped:0};
    if(action==='open')return {tabId:'t2',documentId:'d2'};
    if(action==='check')return {tabId:'t2',documentId:'d2'};
    if(action==='capture'){if(!capture)throw Error('browser_capture_unavailable');return {image:PNG,width:1,height:1,mimeType:'image/png'};}
    throw Error('browser_action_invalid');
  };
  service.mcpRegistry=()=>({call:async(name,args)=>{calls.push([name,args]);return name==='mcp__playwright__browser_snapshot'?{content:[{type:'text',text:SNAPSHOT}]}:{ok:true};}});
  return {calls,requests};
}

test('a recording becomes a draft card with slots, a one-time trial runs with the remembered values, and approval needs inspected evidence',async t=>{
  const f=await fixture(t),s=f.service,{calls,requests}=wire(s,{events}),projectId=s.projectId;
  assert.equal((await s.invoke('browserTeach',{action:'tabs',projectId})).tabs[0].tabId,'t1');
  assert.equal((await s.browserTeach({action:'record',op:'start',projectId,tabId:'t1'})).recording,true);
  const stopped=await s.browserTeach({action:'record',op:'stop',projectId,tabId:'t1',title:'양식 제출'});
  assert.equal(stopped.events,2);assert.equal(stopped.dropped,1);
  const {binding,card}=stopped;assert.equal(binding.projectId,projectId);assert.match(binding.revision,/^[0-9a-f]{16}$/);
  assert.equal(card.status,'draft');assert.deepEqual(card.steps.map(step=>step.tool),['fill_form','click_element']);
  assert.deepEqual(card.inputs,[{slot:'v1',label:'검색어'}]);assert.equal(card.startPage,'https://demo.invalid/form');
  assert.ok(!JSON.stringify(card).includes('누비'),'the typed value never enters the card');
  // Trials are bound to this session and these exact steps.
  await assert.rejects(s.browserTeach({action:'test',binding:{...binding,sessionId:'other'},draftKey:'k',card}),/browser_teach_session_invalid/);
  await assert.rejects(s.browserTeach({action:'test',binding:{...binding,projectId:'other'},draftKey:'k',card}),/project_changed/);
  await assert.rejects(s.browserTeach({action:'test',binding,draftKey:'k',card:{...card,steps:card.steps.slice(1)}}),/browser_teach_card_changed/);
  const edited={...card,teach:{purpose:'검색 결과 확인',steps:{0:{valueSource:{kind:'literal_pending'}}}}};
  const run=await s.browserTeach({action:'test',binding,draftKey:'k1',card:edited});
  assert.equal(run.success,true);assert.equal(run.steps,2);assert.equal(run.draftKey,'k1');assert.deepEqual(run.binding,binding);assert.match(run.receiptId,/^teach-run:/);
  assert.equal(run.captures.length,1);assert.match(run.captures[0].dataUrl,/^data:image\/png;base64,/);
  const typed=calls.find(([name])=>name==='mcp__playwright__browser_type');assert.equal(typed[1].text,'누비','the value comes from session memory');
  assert.ok(calls.some(([name])=>name==='mcp__playwright__browser_click'));
  assert.equal(requests.find(([action])=>action==='open')[1].url,'https://demo.invalid/form');
  // Approval before a save, or without every capture inspected, is refused.
  await assert.rejects(s.browserTeach({action:'approve',binding,draftKey:'k1',slug:'x',hash:'h',version:1,receiptId:run.receiptId,captureIds:[]}),/browser_teach_script_missing/);
  const saved=await s.browserTeach({action:'save',binding,draftKey:'k1',card:edited,receiptId:run.receiptId});
  assert.equal(saved.script.status,'draft');assert.equal(saved.script.slug,'양식-제출');assert.equal(saved.script.version,1);assert.match(saved.script.hash,/^sha256:/);
  const dir=path.join(f.root,'.nubi','browser-scripts','양식-제출');
  const stored=JSON.parse(await readFile(path.join(dir,'card.json'),'utf8'));
  assert.equal(stored.status,'draft');assert.equal(stored.teach.purpose,'검색 결과 확인');assert.ok(!JSON.stringify(stored).includes('누비'));
  assert.equal((await readdir(path.join(dir,'runs'))).length,1);assert.equal((await readdir(path.join(dir,'captures'))).length,1);
  assert.match(await readFile(path.join(dir,'README.md'),'utf8'),/검색 결과 확인/);
  await assert.rejects(s.browserTeach({action:'approve',binding,draftKey:'k1',...saved.script,receiptId:run.receiptId,captureIds:[]}),/browser_teach_evidence_missing/);
  await assert.rejects(s.browserTeach({action:'approve',binding,draftKey:'k1',...saved.script,version:2,receiptId:run.receiptId,captureIds:run.captures.map(c=>c.id)}),/browser_teach_script_mismatch/);
  const approved=await s.browserTeach({action:'approve',binding,draftKey:'k1',...saved.script,receiptId:run.receiptId,captureIds:run.captures.map(c=>c.id)});
  assert.equal(approved.script.status,'reviewed');assert.equal(approved.script.hash,saved.script.hash);assert.equal(approved.script.version,1);assert.equal(approved.script.slug,'양식-제출');
  assert.equal(JSON.parse(await readFile(path.join(dir,'card.json'),'utf8')).status,'reviewed');
  assert.equal((await s.browserTeach({action:'list',projectId})).scripts[0].status,'reviewed');
  await s.browserTeach({action:'discard',binding});
  await assert.rejects(s.browserTeach({action:'test',binding,draftKey:'k',card}),/browser_teach_session_invalid/);
});

test('a failed trial or a missing capture leaves nothing approvable, and a recording without steps yields no session',async t=>{
  const f=await fixture(t),s=f.service,projectId=s.projectId;
  wire(s,{events,capture:false});
  const {binding,card}=await s.browserTeach({action:'record',op:'stop',projectId,tabId:'t1'});
  assert.equal(card.title,'양식','the page title names an untitled recording');
  const run=await s.browserTeach({action:'test',binding,draftKey:'k',card});
  assert.equal(run.success,true);assert.deepEqual(run.captures,[]);
  const saved=await s.browserTeach({action:'save',binding,draftKey:'k',card,receiptId:run.receiptId});
  await assert.rejects(s.browserTeach({action:'approve',binding,draftKey:'k',...saved.script,receiptId:run.receiptId,captureIds:[]}),/browser_teach_evidence_missing/);
  await assert.rejects(s.browserTeach({action:'save',binding,draftKey:'k',card,receiptId:'teach-run:unknown'}),/browser_teach_receipt_missing/);
  wire(s,{events:[{kind:'key',at:1,index:0,key:'F5',items,...page}]});
  const empty=await s.browserTeach({action:'record',op:'stop',projectId,tabId:'t1'});
  assert.equal(empty.card,null);assert.equal(empty.binding,null);assert.equal(empty.skipped,0);
  await assert.rejects(s.browserTeach({action:'record',op:'stop',projectId:'other',tabId:'t1'}),/project_changed/);
  await assert.rejects(s.browserTeach({action:'nope',projectId}),/browser_teach_action_invalid/);
});

test('slugs come from the title and never replace another script with different steps',async t=>{
  assert.equal(scriptSlugFromTitle('  메일 보내기  '),'메일-보내기');assert.equal(scriptSlugFromTitle('Weekly Report!'),'weekly-report');
  assert.match(scriptSlugFromTitle('---'),/^script-[0-9a-f]{6}$/);
  const f=await fixture(t),s=f.service,projectId=s.projectId;
  wire(s,{events});
  const first=await s.browserTeach({action:'record',op:'stop',projectId,tabId:'t1',title:'양식'});
  const one=await s.browserTeach({action:'save',binding:first.binding,draftKey:'k',card:first.card,receiptId:null});
  assert.equal(one.script.slug,'양식');
  wire(s,{events:[events[1]]});
  const second=await s.browserTeach({action:'record',op:'stop',projectId,tabId:'t1',title:'양식'});
  const two=await s.browserTeach({action:'save',binding:second.binding,draftKey:'k',card:second.card,receiptId:null});
  assert.equal(two.script.slug,'양식-2');
  assert.equal(JSON.parse(await readFile(path.join(f.root,'.nubi','browser-scripts','양식','card.json'),'utf8')).steps.length,2,'the first script is untouched');
});
