import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {hash} from '../runtime/files.mjs';
import {RepositoryEvidenceResolver} from '../generated/openwiki.mjs';
import {importantFiles,coverageMap} from '../runtime/wiki-coverage.mjs';

async function page(root,name,source){
 const text='# '+name+'\n\nSynthetic source documentation.\n';await mkdir(path.join(root,'openwiki/.claims'),{recursive:true});await writeFile(path.join(root,'openwiki',name+'.md'),text);
 const resource='repo://'+source,version=(await new RepositoryEvidenceResolver({rootDir:root}).resolve(resource)).evidence.version;
 await writeFile(path.join(root,'openwiki/.claims',name+'.json'),JSON.stringify({schemaVersion:1,pageVersion:hash(text),claims:[{id:name,statement:'Synthetic source documentation.',evidence:[{resource,version}]}]}));
}

test('coverage importance deduplicates W1 representatives and pinned sources with the normal scope checks',async t=>{
 const {root}=await fixture(t);await mkdir(path.join(root,'src'));await writeFile(path.join(root,'src/main.mjs'),'export const main=1;');
 assert.deepEqual(await importantFiles(root,{representatives:['app.txt','src/main.mjs','app.txt'],pinned:['src/main.mjs']}),['app.txt','src/main.mjs']);
 await writeFile(path.join(root,'.env'),'SECRET');await assert.rejects(importantFiles(root,{representatives:['.env']}),/path_scope/);
 await assert.rejects(importantFiles(root,{representatives:['../outside.txt']}),/path_scope/);
});

test('coverage joins completed seed paths and current Claims while exposing missing entry points',async t=>{
 const {root}=await fixture(t);await writeFile(path.join(root,'main.mjs'),'export const main=1;');await page(root,'home','app.txt');
 await writeFile(path.join(root,'openwiki/.run.json'),JSON.stringify({plan:{pages:[{path:'/openwiki/home.md',status:'complete',seedPaths:['app.txt']},{path:'/openwiki/missing.md',status:'skipped',seedPaths:['main.mjs']}]}}));
 const c=await coverageMap(root,{important:['app.txt','main.mjs']});assert.equal(c.ratio,.5);assert.deepEqual(c.uncovered,['main.mjs']);assert.deepEqual(c.pages['openwiki/home.md'],['app.txt']);assert.deepEqual(c.files['app.txt'],['openwiki/home.md']);assert.equal(c.files['main.mjs'],undefined);
 await page(root,'entry','main.mjs');assert.equal((await coverageMap(root,{important:['app.txt','main.mjs']})).ratio,1);
});

test('changed Claims, unavailable sources, ignored paths and symlinks never inflate coverage',async t=>{
 const {root,directory}=await fixture(t);await page(root,'home','app.txt');await writeFile(path.join(root,'app.txt'),'changed');assert.equal((await coverageMap(root,{important:['app.txt']})).ratio,0);
 await page(root,'home','app.txt');await writeFile(path.join(root,'.openwikiignore'),'app.txt\n');assert.equal((await coverageMap(root,{important:['app.txt']})).ratio,0);
 await writeFile(path.join(directory,'outside.txt'),'PRIVATE');await symlink(path.join(directory,'outside.txt'),path.join(root,'escape.txt'));
 await assert.rejects(importantFiles(root,{representatives:['escape.txt']}),/path_scope/);await assert.rejects(coverageMap(root,{important:[]}),/path_scope/);
});

for(const repair of [true,false])test(`initialization audits a missed entry and supplements once (${repair?'covered':'still uncovered'})`,async t=>{
 const {root,service}=await fixture(t);await rm(path.join(root,'openwiki'),{recursive:true});await writeFile(path.join(root,'main.mjs'),'export const main=1;');service.store.set('wiki-init',null);service.providers={status:()=>({connected:true,provider:'fixture',model:'fixture'}),dispose(){}};
 const calls=[];service.wikiInitializer=async options=>{calls.push({mode:options.mode,context:options.planningContext});options.onModelCall();await page(options.root,'home','app.txt');if(calls.length===2&&repair)await page(options.root,'entry','main.mjs');};
 await service.initializeWiki();await service.wikiInitPromise;const job=service.wikiInitialization();assert.equal(job.state,'completed',JSON.stringify(job));assert.equal(calls.length,2);assert.equal(calls[1].mode,'update');assert.match(calls[1].context,/main\.mjs/);
 assert.equal(job.report.rounds,2);assert.equal(job.report.modelCalls,2);assert.equal(job.report.coveredRatio,repair?1:.5);assert.deepEqual(job.report.uncovered,repair?[]:['main.mjs']);assert.equal(job.report.pages,repair?2:1);assert.deepEqual(job.report.skipped,{large:0,binary:0,encoding:0});assert(job.report.durationMs>=0);
 await service.initializeWiki();assert.equal(calls.length,2,'reopening does not silently add another supplement');
});

test('manual coverage reinforcement binds selected files to the existing proposal and apply approvals',async t=>{
 const {root,service}=await fixture(t);await writeFile(path.join(root,'main.mjs'),'export const main=1;');await page(root,'home','app.txt');
 const current=(await service.invoke('wikiCoverage')).coverage;assert(current.uncovered.includes('main.mjs'));
 const proposed=await service.wikiUpdate({method:'propose',coverageFiles:['main.mjs']});assert.equal(proposed.state,'proposed');assert.deepEqual(proposed.coverageFiles,['main.mjs']);assert.equal(service.wikiUpdateRun,undefined);
 let context;service.providers={status:()=>({connected:true,provider:'fixture',model:'fixture'}),dispose(){}};service.wikiUpdater=async options=>{context=options.planningContext;await page(options.root,'entry','main.mjs');};
 await service.wikiUpdate({method:'run',id:proposed.id,fingerprint:proposed.fingerprint});await service.wikiUpdateRun?.promise;const result=service.store.get('wiki-update:'+proposed.id);assert.equal(result.state,'ready',JSON.stringify(result));assert.match(context,/main\.mjs/);
 await assert.rejects(readFile(path.join(root,'openwiki/entry.md')),{code:'ENOENT'});await assert.rejects(service.wikiUpdate({method:'apply',id:result.id,fingerprint:'wrong'}));await service.wikiUpdate({method:'apply',id:result.id,fingerprint:result.fingerprint});assert.match(await readFile(path.join(root,'openwiki/entry.md'),'utf8'),/Synthetic/);
 await assert.rejects(service.wikiUpdate({method:'propose',coverageFiles:['../outside']}),/path_scope/);
});

test('coverage proposals keep the chosen paths and approvals visible even when normal Wiki status is current',async()=>{
 const {wikiUpdateView}=await import('../ui/wiki-update-view.mjs');const view=wikiUpdateView({status:{state:'current'},update:{state:'proposed',coverageFiles:['main.mjs']}});
 assert.match(view.title,/빠진/);assert.deepEqual(view.actions,['run','discard']);assert(view.lines.some(line=>line.includes('확인')&&line.includes('반영')));assert(view.pages.some(page=>page.path==='main.mjs'));
});

test('coverage dictionaries treat prototype-shaped source names as data',async t=>{
 const {root}=await fixture(t);await writeFile(path.join(root,'__proto__'),'synthetic');await page(root,'prototype','__proto__');
 const result=await coverageMap(root,{important:['__proto__']});assert.equal(result.ratio,1);assert.deepEqual(result.files['__proto__'],['openwiki/prototype.md']);
});

test('completed seed-only navigation survives publication without treating a later page edit as current coverage',async t=>{
 const {root,service}=await fixture(t);await rm(path.join(root,'openwiki'),{recursive:true});service.store.set('wiki-init',null);service.providers={status:()=>({connected:true,provider:'fixture',model:'fixture'}),dispose(){}};
 let calls=0;service.wikiInitializer=async({root:copy})=>{calls++;await mkdir(path.join(copy,'openwiki'),{recursive:true});await writeFile(path.join(copy,'openwiki/home.md'),'# Navigation only\n');await writeFile(path.join(copy,'openwiki/.run.json'),JSON.stringify({plan:{pages:[{path:'/openwiki/home.md',status:'complete',seedPaths:['app.txt']}]}}));};
 await service.initializeWiki();await service.wikiInitPromise;assert.equal(calls,1);assert.equal(service.wikiInitialization().report.coveredRatio,1);assert.equal((await service.invoke('wikiCoverage')).coverage.ratio,1);
 await writeFile(path.join(root,'openwiki/home.md'),'# Human edit\n');assert.equal((await service.invoke('wikiCoverage')).coverage.ratio,0);
});

test('coverage context stays within the W1 navigation budget and names omissions explicitly',async()=>{
 const {coveragePlanningContext}=await import('../runtime/wiki-coverage.mjs');const context=coveragePlanningContext(Array.from({length:10000},(_,i)=>'합성/'+i+'-'+('file'.repeat(100))+'.mjs'));
 assert(Buffer.byteLength(context)<=200000);const data=JSON.parse(context.slice(context.indexOf('\n')+1));assert(data.omitted>0);assert.equal(data.paths.length+data.omitted,10000);
});

test('the native navigation index is counted as a page without asking it for factual Claims',async t=>{
 const {root}=await fixture(t);await page(root,'home','app.txt');await writeFile(path.join(root,'openwiki/index.md'),'# Index\n\n[Home](home.md)\n');const coverage=await coverageMap(root,{important:['app.txt']});assert.equal(coverage.ratio,1);assert.equal(Object.keys(coverage.pages).length,2);
});

for(const change of ['source','page'])test(`an imported native completed plan cannot re-certify changed ${change} bytes`,async t=>{
 const {root}=await fixture(t);await writeFile(path.join(root,'openwiki/home.md'),'# Native navigation\n');await writeFile(path.join(root,'openwiki/.run.json'),JSON.stringify({plan:{pages:[{path:'/openwiki/home.md',status:'complete',seedPaths:['app.txt']}]}}));
 const before=await coverageMap(root,{important:['app.txt'],nativeRun:true});assert.equal(before.ratio,1);
 await writeFile(path.join(root,change==='source'?'app.txt':'openwiki/home.md'),change==='source'?'Changed original bytes.':'# Edited page\n');
 const after=await coverageMap(root,{important:['app.txt'],plannedPages:before.planLinks});assert.equal(after.ratio,0,'unattested imported .run.json cannot override the saved source/page versions');assert.deepEqual(after.uncovered,['app.txt']);
});
