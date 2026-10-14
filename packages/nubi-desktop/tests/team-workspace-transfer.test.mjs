import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const {startTeamWorkspace}=createRequire(import.meta.url)('../electron-app/team-workspace.cjs');
const repo='/api/v3/repos/Manufacturing-IT/ai_workspace';
const sha='a'.repeat(40),tree='b'.repeat(40),html='<html><head></head><body>Fixture</body></html>';
const blob=createHash('sha1').update(Buffer.from('blob '+Buffer.byteLength(html)+'\0')).update(html).digest('hex');
test('hosted file apps read encoded site blobs above 24 MiB while unrelated requests and logout stay bounded',async t=>{
 let remoteCalls=0;
 const account={generation:1,state:'connected',record:{token:'fixture'},profile:{id:7,login:'nubi'},accessController:new AbortController(),now:Date.now,credential:async()=>({generation:1,token:'fixture'}),request:async route=>{
  if(route===repo+'/git/ref/heads/main')return {object:{sha}};
  if(route===repo+'/git/commits/'+sha)return {tree:{sha:tree}};
  if(route===repo+'/git/trees/'+tree+'?recursive=1')return {tree:[{path:'index.html',type:'blob',mode:'100644',sha:blob,size:Buffer.byteLength(html)}]};
  if(route===repo+'/git/blobs/'+blob)return {encoding:'base64',content:Buffer.from(html).toString('base64')};
  throw Error('unexpected bootstrap route');
 },fetcher:async()=>{remoteCalls++;return new Response(JSON.stringify({encoding:'base64',content:'A'.repeat(25*1024*1024)}));}};
 const workspace=await startTeamWorkspace({account});t.after(()=>workspace.close());const url=new URL(workspace.url),prefix=url.pathname.slice(0,url.pathname.lastIndexOf('/')+1),key=prefix.split('/')[2];
 const call=async target=>{const response=await fetch(url.origin+prefix+'__workspace/api',{method:'POST',headers:{Origin:url.origin,'Content-Type':'application/json','X-Nubi-Workspace':key},body:JSON.stringify({url:'https://code.sdsdev.co.kr'+target,method:'GET'})});return response.json();};
 const loaded=await call(repo+'/git/blobs/'+sha);assert.equal(loaded.status,200);assert.ok(loaded.body.length>24*1024*1024);
 const limited=await call(repo+'/contents/data/workspace/catalog.json');assert.equal(limited.status,413);
 const denied=await call('/api/v3/repos/other/private');assert.equal(denied.status,403);assert.equal(remoteCalls,2);
 account.generation++;const expired=await call(repo+'/git/blobs/'+sha);assert.equal(expired.status,401);assert.equal(remoteCalls,2);
});
