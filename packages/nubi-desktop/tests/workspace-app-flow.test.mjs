import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {createWorkspaceFetch}=createRequire(import.meta.url)('../electron-app/workspace-fetch.cjs');
const hash=text=>createHash('sha1').update(text).digest('hex');
const gitBlob=text=>hash(Buffer.concat([Buffer.from('blob '+Buffer.byteLength(text)+'\0'),Buffer.from(text)]));
const repo='/api/v3/repos/Manufacturing-IT/ai_workspace',catalogPath='data/workspace/catalog.json';

test('embedded app client registers links and files, reads back, rejects stale edits and deletes without losing other files',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'nubi-app-flow-'));const oldWindow=globalThis.window;t.after(async()=>{globalThis.window=oldWindow;await rm(directory,{recursive:true,force:true});});
 await build({stdin:{contents:"export {createWorkspaceClient} from './ui/ai-workspace/workspace/workspaceClient.js';export {prepareWorkspaceSite} from './ui/ai-workspace/workspace/workspaceSite.js';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},outfile:path.join(directory,'client.mjs'),logLevel:'silent'});
 const {createWorkspaceClient,prepareWorkspaceSite}=await import(pathToFileURL(path.join(directory,'client.mjs')));
 const user={id:7,login:'nubi'},account={generation:1,state:'connected',accessController:new AbortController(),status:async()=>({connected:true}),credential:async()=>({generation:1,token:'test-only'})};
 let head=hash('head'),serial=0;const blob=JSON.stringify({schemaVersion:1,items:[]}),blobs=new Map([[gitBlob(blob),blob],[gitBlob('untouched'),'untouched']]),trees=new Map([[hash('tree'),new Map([[catalogPath,gitBlob(blob)],['README.md',gitBlob('untouched')]])]]),commits=new Map([[head,{tree:{sha:hash('tree')},parents:[]}]]),calls=[];
 const bridge=createWorkspaceFetch(account,{fetcher:async(url,options)=>{
  const u=new URL(url),route=decodeURIComponent(u.pathname),method=options.method,body=options.body?JSON.parse(options.body):null;calls.push({route,method});assert.equal(options.headers.Authorization,'Bearer test-only');assert.equal(options.redirect,'error');
  const response=(value,status=200)=>new Response(JSON.stringify(value),{status});
  if(route==='/api/v3/user')return response(user);
  const relative=route.slice(repo.length);
  if(method==='GET'){
   if(relative==='/git/ref/heads/main')return response({object:{sha:head}});
   if(relative.startsWith('/git/commits/'))return response(commits.get(relative.split('/').at(-1)));
   if(relative.startsWith('/contents/')){const revision=u.searchParams.get('ref')==='main'?head:u.searchParams.get('ref'),sha=trees.get(commits.get(revision)?.tree.sha)?.get(relative.slice('/contents/'.length));return sha?response({sha,encoding:'base64',content:Buffer.from(blobs.get(sha)).toString('base64')}):response({},404);}
  }
  if(method==='POST'){
   if(relative==='/git/blobs'){const sha=gitBlob(body.content);blobs.set(sha,body.content);return response({sha});}
   if(relative==='/git/trees'){const tree=new Map(trees.get(body.base_tree));for(const entry of body.tree)tree.set(entry.path,entry.sha);const sha=hash('tree'+ ++serial);trees.set(sha,tree);return response({sha});}
   if(relative==='/git/commits'){const sha=hash('commit'+ ++serial);commits.set(sha,{tree:{sha:body.tree},parents:body.parents});return response({sha});}
  }
  if(method==='PATCH'&&relative==='/git/refs/heads/main'){assert.equal(body.force,false);if(commits.get(body.sha)?.parents[0]!==head)return response({},409);head=body.sha;return response({object:{sha:head}});}
  throw Error('unexpected fixture request '+method+' '+relative);
 }});
 globalThis.window={nubi:{request:async(method,args)=>{assert.equal(method,'ghesFetch');return bridge(args);}}};
 const client=createWorkspaceClient({session:{host:'code.sdsdev.co.kr',token:'nubi-host-session',user},resolveRole:async()=>'user'});
 const initial=await client.list(),id='11111111-1111-4111-8111-111111111111';
 const link=await client.save({snapshot:initial,id,fields:{title:'Link app',description:'For work',url:'https://app.example.invalid'}});
 assert.equal((await client.list()).document.items[0].url,'https://app.example.invalid/');
 await assert.rejects(client.save({snapshot:initial,id,fields:{title:'Stale',description:'Old',url:'https://other.example.invalid'}}),e=>e.status===409);
 const updated=await client.save({snapshot:link.snapshot,existing:link.item,id,fields:{title:'Updated app',description:'Reviewed',url:link.item.url}});assert.equal(updated.item.title,'Updated app');
 const site=await prepareWorkspaceSite({schemaVersion:1,entry:'index.html',files:[{path:'index.html',content:Buffer.from('<h1>Local page</h1>').toString('base64')}]});
 const savedSite=await client.save({snapshot:updated.snapshot,id:'22222222-2222-4222-8222-222222222222',fields:{title:'File app',description:'Page bundle',kind:'site'},site});
 assert.deepEqual(await client.loadSite(savedSite.item.site),site.document);
 const removed=await client.remove({snapshot:savedSite.snapshot,item:updated.item});assert.equal(removed.document.items.length,1);assert.equal(removed.document.items[0].kind,'site');assert.equal(blobs.get(trees.get(commits.get(head).tree.sha).get('README.md')),'untouched');
 assert.equal(calls.filter(c=>c.method==='PATCH').length,4);
});
