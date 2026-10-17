import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {defaultWikiUpdater} from '../runtime/wiki-update.mjs';
import {wikiInitializationError} from '../runtime/wiki-initialization-error.mjs';
import {wikiUpdateView} from '../ui/wiki-update-view.mjs';

async function settle(service,id){
  for(let i=0;i<300;i++){
    const update=(await service.wikiUpdate({method:'status'})).updates.find(row=>row.id===id);
    if(update.state!=='running')return update;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw Error('fixture did not settle');
}

test('existing Wiki retains the actual failed stage and Claude cause, then resumes without publishing early',async t=>{
  const {service,root}=await fixture(t),original=await readFile(path.join(root,'openwiki/home.md'),'utf8');
  let calls=0;
  service.wikiUpdater=async({root:copy,onEvent})=>{
    calls++;
    onEvent({type:'progress',stage:'reviewing',completed:0,total:1});
    if(calls===1){
      await writeFile(path.join(copy,'openwiki/saved.md'),'# Retained\n');
      throw Error('private runner context',{cause:Error('claude_cli_timeout')});
    }
    assert.equal(await readFile(path.join(copy,'openwiki/saved.md'),'utf8'),'# Retained\n');
    await writeFile(path.join(copy,'openwiki/home.md'),'# Updated\n');
    return {};
  };
  const proposal=await service.wikiUpdate({method:'propose'});
  await service.wikiUpdate({method:'run',id:proposal.id,fingerprint:proposal.fingerprint});
  const failed=await settle(service,proposal.id);
  assert.equal(failed.error,'claude_cli_timeout');
  assert.equal(failed.stage,'reviewing');
  assert.equal(failed.canResume,true);
  assert(!JSON.stringify(failed).includes('private runner context'));
  assert.equal(await readFile(path.join(root,'openwiki/home.md'),'utf8'),original);
  await service.wikiUpdate({method:'status'});assert.equal(calls,1);
  await service.wikiUpdate({method:'resume',id:proposal.id,fingerprint:proposal.fingerprint});
  const ready=await settle(service,proposal.id);
  assert.equal(ready.state,'ready');assert.equal(calls,2);
  assert.equal(ready.error,undefined,'a recovered job has no obsolete failure');
  assert.equal(await readFile(path.join(root,'openwiki/home.md'),'utf8'),original);
  await service.wikiUpdate({method:'apply',id:proposal.id,fingerprint:ready.fingerprint});
  assert.equal(await readFile(path.join(root,'openwiki/home.md'),'utf8'),'# Updated\n');
});

test('a runner replacement error cannot hide the model failure already observed by Desktop',async t=>{
  const {service,root}=await fixture(t);let calls=0;
  service.providers={status:()=>({connected:true,provider:'fixture',model:'fixture'}),dispose(){},async complete(){calls++;throw Error('claude_login_required');}};
  const load=async()=>({NubiOpenWikiModel:class{constructor({complete}){this.complete=complete;}},async runNativeRepositoryGeneration({model}){
    await model.complete([{role:'user',content:'update'}],[]).catch(()=>{});
    throw Error('private planner replacement failure');
  }});
  await assert.rejects(defaultWikiUpdater(service,{load})({root,updateId:'wrapped',signal:new AbortController().signal}),{message:'claude_login_required'});
  assert.equal(calls,1);
});

test('known wrapped failures retain codes while unknown text stays private',()=>{
  for(const code of ['claude_login_required','claude_cli_missing','claude_cli_unavailable','claude_cli_update','claude_cli_failed','claude_cli_timeout','claude_response_invalid','invalid_model']){
    assert.equal(wikiInitializationError(Error('private wrapper',{cause:Error(code)}),'reviewing'),code);
  }
  assert.equal(wikiInitializationError(Error('outer',{cause:Object.assign(Error('private socket'),{code:'ECONNRESET'})}),'generating'),'network_error');
  assert.equal(wikiInitializationError(Error('private',{cause:Error('private endpoint and body')}),'planning'),'wiki_failed');
  const cycle=Error('private');cycle.cause=cycle;
  assert.equal(wikiInitializationError(cycle,'planning'),'wiki_failed');
  assert.equal(wikiInitializationError(Error('path_scope',{cause:Error('unauthorized')}),'reading'),'path_scope');
});

test('retained Wiki failures explain the next action and expose the recorded stage and safe code',()=>{
  const view=wikiUpdateView({update:{state:'failed',canResume:true,stage:'reviewing',error:'claude_login_required'}});
  assert.match(view.detail,/Claude.*로그인/);assert.doesNotMatch(view.detail,/오류: claude/);
  assert.deepEqual(view.diagnostic,{stage:'내용 검토',code:'claude_login_required'});
  assert.deepEqual(view.actions,['resume','restart','discard']);
  const unknown=wikiUpdateView({update:{state:'failed',canResume:true,error:'private server body'}});
  assert(!JSON.stringify(unknown).includes('private server body'));
});
