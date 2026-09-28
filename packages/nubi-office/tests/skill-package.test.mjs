import test from 'node:test';
import assert from 'node:assert/strict';
import {packageMetadata,packageManifest,packagePath,sha256} from '../worker/skill-package.mjs';
import {createSkillWorkspace} from '../worker/skill-workspace.mjs';
import {createActivityLog} from '../worker/activity.mjs';
import {createWorker} from '../worker/main.mjs';
import {startAgent} from '../worker/agent.mjs';
import {workbook,scriptedProvider,contract,call as toolCall,text} from './harness-fixtures.mjs';
const id='00000000-0000-4000-8000-000000000099';
const content='---\nname: team-writing\ndescription: Write company documents using the team style.\n---\nRead references/team/style.md. Ask the audience with ask_user before writing. Use scripts/tables/totals.js for totals.';
function fixture({host='excel',transform}={}){
  const bytes=new Map(Object.entries({'SKILL.md':content,'references/team/style.md':'결론, 근거, 다음 행동 순서. 사용자에게 대상 독자를 확인한다.','scripts/tables/totals.js':'function transform(input) { return {total: input.values.reduce((a,b)=>a+b,0)}; }','scripts/tables/totals.py':'def transform(input): return sum(input["values"])','references/long.txt':'기준 내용\n'.repeat(10000),'assets/logo.bin':Buffer.from([0,255,1,2])}).map(([key,value])=>[key,Buffer.from(value)]));
  const manifest=packageManifest([...bytes].map(([path,value])=>({path,size:value.length,sha256:sha256(value)})));
  const skill={id,host,revision:1,name:'team-writing',instructions:packageMetadata(content).description,questions:[],package:{version:1,sha256:manifest.sha256,fileCount:manifest.files.length,totalBytes:manifest.totalBytes}};
  const calls=[],controller=new AbortController(),metrics={},activity=createActivityLog();
  async function call(name,args){
    calls.push({name,args});let result;
    if(name==='document_skill_catalog')result={host,entries:[skill],unreadable:0};
    if(name==='document_skill_manifest')result={skill,files:manifest.files};
    if(name==='document_skill_resource'){
      const data=bytes.get(args.path),offset=args.offset,end=Math.min(data.length,offset+48000);
      result={id,revision:1,packageSha256:manifest.sha256,path:args.path,sha256:sha256(data),size:data.length,offset,data:data.subarray(offset,end).toString('base64'),nextOffset:end<data.length?end:null};
    }
    return transform?transform(name,args,result):structuredClone(result);
  }
  const workspace=createSkillWorkspace({host,signal:controller.signal,metrics,activity,skillCall:call});
  return{skill,manifest,bytes,calls,call,controller,metrics,activity,workspace};
}
test('Pi frontmatter parser discovers standard skill metadata without running uploaded code',()=>{
  assert.equal(packageMetadata(content).name,'team-writing');
  assert.equal(packageMetadata(content.replace('description: Write company documents using the team style.','description: >\n  Write company documents\n  using team style.')).description,'Write company documents using team style.\n');
  for(const bad of ['missing frontmatter',content.replace('team-writing','Bad Name'),content.replace('description:','other:'),'---\nname: x\nname: y\ndescription: z\n---\nbody'])assert.throws(()=>packageMetadata(bad),/document_skill_package_invalid/);
});
test('manifest preserves exact nested paths and rejects traversal, Windows aliases, duplicates and conflicts',()=>{
  const f=fixture();assert.ok(f.manifest.files.some(f=>f.path==='scripts/tables/totals.js'));
  for(const path of ['../secret','a/../b','C:/x','a\\b','CON.txt','sub/nul','a//b','a/b.','a/b ', 'a:stream','/absolute'])assert.throws(()=>packagePath(path),/document_skill_package_invalid/);
  for(const extra of [{...f.manifest.files[0],path:'skill.md'},{...f.manifest.files[0],path:'references'},{...f.manifest.files[0],path:'other/SKILL.md'},{...f.manifest.files[0],path:'oversized',size:2097153}])assert.throws(()=>packageManifest([...f.manifest.files,extra]),/document_skill_package_invalid/);
});
test('model discovers and activates uploaded skills then reads nested references through actual Pi tools',async()=>{
  const f=fixture(),w=f.workspace;
  const list=await w.execute('list_document_skills',{});assert.equal(list.skills[0].id,id);assert.equal(f.calls.some(c=>c.name==='document_skill_resource'),false);
  const active=await w.execute('use_document_skill',{id,revision:1});assert.equal(active.content,content);assert.equal(f.calls.filter(c=>c.name==='document_skill_resource').length,1);
  assert.ok((await w.execute('find',{pattern:'*.md',path:active.baseDir})).content.includes('references/team/style.md'));
  const result=await w.execute('read',{path:active.baseDir+'/references/team/style.md'});assert.match(result.content,/대상 독자/);
  assert.equal((await w.execute('write',{path:active.entrypoint,content:'replace'})).error,'workspace_read_only');
  assert.equal(w.skillContext().active[0].instructions,content);
  await w.execute('use_document_skill',{id,revision:1});assert.equal(f.calls.filter(c=>c.name==='document_skill_manifest').length,1);
});
test('nested JavaScript is lazy-loaded and actually executes in the existing WASM runtime',async()=>{
  const f=fixture();await f.workspace.execute('list_document_skills',{});const active=await f.workspace.execute('use_document_skill',{id,revision:1});
  const result=await f.workspace.execute('run_script',{path:active.baseDir+'/scripts/tables/totals.js',input:'{"values":[10,20,30]}'});
  assert.equal(result.executed,true);assert.deepEqual(result.output,{total:60});assert.equal(result.engine,'quickjs-wasm');assert.ok(result.resultPath.startsWith('draft/'));
});
test('paged native transport preserves long Unicode references and binary asset identity',async()=>{
  const f=fixture();await f.workspace.execute('list_document_skills',{});const active=await f.workspace.execute('use_document_skill',{id,revision:1});
  const path=active.baseDir+'/references/long.txt';let page=await f.workspace.execute('read',{path}),joined=page.content;
  while(page.truncated){page=await f.workspace.execute('read',{path,offset:page.nextOffset,expectedSha256:page.sha256});joined+=page.content;}
  assert.equal(joined,f.bytes.get('references/long.txt').toString());assert.ok(f.calls.filter(c=>c.args.path==='references/long.txt').length>1);
  const asset=await f.workspace.execute('read',{path:active.baseDir+'/assets/logo.bin'});assert.equal(asset.binary,true);assert.equal(asset.sha256,sha256(f.bytes.get('assets/logo.bin')));assert.equal(asset.content,undefined);
});
test('corrupt or changed resource chunks are never admitted and user cancellation fences late reads',async()=>{
  for(const field of ['revision','sha256','nextOffset','data']){
    const f=fixture({transform:(name,args,result)=>name==='document_skill_resource'?{...result,[field]:field==='revision'?2:field==='nextOffset'?48000:'wrong'}:result});
    await f.workspace.execute('list_document_skills',{});const result=await f.workspace.execute('use_document_skill',{id,revision:1});assert.ok(result.error);assert.equal(f.workspace.skillContext().active.length,0);
  }
  const f=fixture({transform:(name,args,result)=>{if(name==='document_skill_resource')f.controller.abort();return result;}});
  await f.workspace.execute('list_document_skills',{});await assert.rejects(f.workspace.execute('use_document_skill',{id,revision:1}),/cancelled/);
});
test('explicit package selection initializes exact instructions before planning for all three Office hosts',async()=>{
  for(const host of ['excel','word','powerpoint']){
    const f=fixture({host});const w=createSkillWorkspace({host,documentSkill:f.skill,skillCall:f.call,signal:f.controller.signal,metrics:{},activity:createActivityLog()});
    await w.initialize();assert.equal(w.skillContext().active[0].instructions,content);assert.equal(f.calls.some(c=>c.name==='document_skill_catalog'),false);
  }
});
test('worker metadata endpoint parses packages without model calls or tool permission grants',async()=>{
  const worker=createWorker({dispose(){},complete(){assert.fail('No model required to import metadata');}});
  const result=await worker.dispatch('skillPackageMetadata',{content:content.replace('---\nRead','allowed-tools: Bash(*)\n---\nRead')});assert.equal(result.name,'team-writing');assert.equal(result.tools,undefined);worker.dispose();
});

test('actual Excel actor invokes registered skill discovery and activation through the existing host loop',async()=>{
  const f=fixture(),native=workbook();let actor=0,sawSkill=false;
  const providers=scriptedProvider({task:contract([],{intent:'analyze'}),actor:messages=>{
    actor++;if(actor===1)return toolCall('list_document_skills',{});if(actor===2)return toolCall('use_document_skill',{id,revision:1});
    sawSkill=messages.some(m=>JSON.stringify(m).includes('references/team/style.md'));return text('등록된 작성 규칙을 읽었습니다.');
  }});
  const run=startAgent({request:'이 문서의 작성 규칙을 검토해줘',mode:'analyze',scope:native.snapshot(),providers,skillPackagesAvailable:true,resilienceOptions:{wait:async()=>{},random:()=>0}});
  try{
    for(let i=0;i<3000;i++){
      const s=run.status();if(s.state!=='running')break;
      if(s.action){assert.notEqual(s.action.name,'request_approval');run.respond(s.action.callId,s.action.name.startsWith('document_skill_')?await f.call(s.action.name,s.action.payload):await native.action(s.action));}
      await new Promise(r=>setImmediate(r));if(sawSkill)break;
    }
    assert.ok(sawSkill);assert.equal(native.writes,0);assert.ok(f.calls.some(c=>c.name==='document_skill_resource'));
  }finally{run.cancel();await run.promise;}
});

test('failed activation rolls back all mounted files and does not leave a usable half-skill',async()=>{
  const f=fixture({transform:(name,args,result)=>name==='document_skill_resource'?{...result,data:Buffer.from('bad').toString('base64')}:result});
  await f.workspace.execute('list_document_skills',{});assert.ok((await f.workspace.execute('use_document_skill',{id,revision:1})).error);
  assert.equal(f.workspace.context().files.some(file=>file.path.includes('/user-')),false);assert.equal(f.workspace.skillContext().active.length,0);
});
test('skill lookup prioritizes matching descriptions without removing other registered skills',async()=>{
  const f=fixture();const other={...f.skill,id:'00000000-0000-4000-8000-000000000098',name:'finance',instructions:'금융 정산과 결산 양식'};
  const w=createSkillWorkspace({host:'excel',signal:f.controller.signal,metrics:{},activity:createActivityLog(),skillCall:async(name,args)=>name==='document_skill_catalog'?{host:'excel',entries:[f.skill,other],unreadable:0}:f.call(name,args)});
  const result=await w.execute('list_document_skills',{query:'금융 정산'});assert.equal(result.skills[0].name,'finance');assert.equal(result.skills.length,2);assert.equal(w.skillContext().catalog[0].name,'finance');
});

test('fifty registered skills stay discoverable without injecting every description into context',async()=>{
  const f=fixture();
  const entries=Array.from({length:50},(_,index)=>({...f.skill,id:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,name:`skill-${index}`,instructions:index===47?'special budget report':`document style ${index}`}));
  const w=createSkillWorkspace({host:'excel',signal:f.controller.signal,metrics:{},activity:createActivityLog(),skillCall:async(name,args)=>name==='document_skill_catalog'?{host:'excel',entries,unreadable:0}:f.call(name,args)});
  const first=await w.execute('list_document_skills',{});assert.equal(first.skills.length,10);assert.equal(first.total,50);assert.equal(first.nextOffset,10);
  assert.equal(w.skillContext().catalog.length,5);assert.equal(w.skillContext().catalogTotal,50);
  const ids=new Set(first.skills.map(skill=>skill.id));
  for(let offset=10;offset<50;offset+=10){const page=await w.execute('list_document_skills',{offset});for(const skill of page.skills)ids.add(skill.id);assert.equal(page.nextOffset,offset===40?null:offset+10);}
  assert.equal(ids.size,50);
  const matched=await w.execute('list_document_skills',{query:'special budget'});assert.equal(matched.skills[0].name,'skill-47');assert.equal(matched.total,50);
  assert.equal((await w.execute('list_document_skills',{limit:11})).error,'tool_arguments_invalid');
});

test('an imported Python script goes through environment and execution gates, never an automatic shell',async()=>{
  const f=fixture();await f.workspace.execute('list_document_skills',{});const active=await f.workspace.execute('use_document_skill',{id,revision:1});
  const result=await f.workspace.execute('run_script',{path:active.baseDir+'/scripts/tables/totals.py',input:'{"values":[1,2]}'});
  assert.equal(result.error,'python_environment_required');assert.equal(f.workspace.context().lastScript,null);
  assert.ok(f.calls.some(c=>c.args.path==='scripts/tables/totals.py'));
});
