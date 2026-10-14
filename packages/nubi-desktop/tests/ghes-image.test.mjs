import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {ghesImageTarget,fetchGhesImage}=require('../electron-app/ghes-image.cjs');
const {DesktopGhesAccount}=require('../electron-app/ghes-profile-status.cjs');
const {ORIGIN}=require('../../nubi-vscode/src/ghes.cjs');
const AVATARS='https://avatars.code.sdsdev.co.kr';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZHcAAAAASUVORK5CYII=','base64');
const image=()=>new Response(png,{headers:{'content-type':'image/png'}});
const redirect=location=>new Response(null,{status:302,headers:{location}});

test('only the company host and its avatars/media hosts are image targets',()=>{
 for(const value of [ORIGIN+'/avatars/u/1',AVATARS+'/u/1?v=4','https://media.code.sdsdev.co.kr/x.png'])assert.ok(ghesImageTarget(value),value);
 for(const value of ['http://code.sdsdev.co.kr/avatars/u/1','https://evil.example/u/1','https://code.sdsdev.co.kr:8443/a','https://u:p@code.sdsdev.co.kr/a','https://x.avatars.code.sdsdev.co.kr/u/1','https://raw.code.sdsdev.co.kr/a','not a url'])assert.equal(ghesImageTarget(value),null,value);
});

test('a photo redirected to the avatars host loads, and the token never leaves the main host',async()=>{
 const calls=[];
 const apiFetch=async(url,options)=>{calls.push({url,options});return url.startsWith(ORIGIN)?redirect(AVATARS+'/u/42?v=4'):image();};
 const result=await fetchGhesImage(ORIGIN+'/avatars/u/42',{token:'fixture-token',apiFetch});
 assert.equal(result.sniffed,'image/png');assert.equal(calls.length,2);
 assert.equal(calls[0].options.headers.Authorization,'Bearer fixture-token');assert.equal(calls[0].options.redirect,'manual');
 assert.equal(new URL(calls[1].url).hostname,'avatars.code.sdsdev.co.kr');assert.equal(calls[1].options.headers.Authorization,undefined);
});

test('a redirect off the company hosts or a login page falls back to the company session without the token',async()=>{
 const sessionCalls=[];
 for(const api of [async()=>redirect('https://sso.example/login'),async()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}})]){
  sessionCalls.length=0;
  const result=await fetchGhesImage(ORIGIN+'/avatars/u/42',{token:'fixture-token',apiFetch:api,sessionFetch:async(url,options)=>{sessionCalls.push({url,options});return image();}});
  assert.equal(result.sniffed,'image/png');assert.equal(sessionCalls.length,1);
  assert.equal(sessionCalls[0].options.redirect,'follow');assert.equal(sessionCalls[0].options.credentials,'include');
  assert.equal(sessionCalls[0].options.headers.Authorization,undefined);
 }
 assert.equal(await fetchGhesImage(ORIGIN+'/a',{sessionFetch:async()=>new Response('<html>sso</html>',{headers:{'content-type':'text/html'}})}),null);
 assert.equal(await fetchGhesImage('https://evil.example/a',{sessionFetch:async()=>image()}),null);
 assert.equal(await fetchGhesImage(ORIGIN+'/a',{sessionFetch:async()=>new Response(Buffer.alloc(64,1),{headers:{'content-type':'image/png'}}),limit:32}),null,'over the limit');
});

test('the account photo works when GHES serves photos from the avatars host (subdomain isolation)',async()=>{
 const user={id:42,login:'nubi-user',name:'누비',avatar_url:AVATARS+'/u/42?v=4',html_url:ORIGIN+'/nubi-user'};
 const tokens=[];
 const account=new DesktopGhesAccount({secrets:{get:async()=>null,store:async()=>{},delete:async()=>{}},cacheAvatars:true,
  avatarFetcher:async()=>{throw Error('Redirect was cancelled');},
  fetcher:async(url,options)=>{const u=new URL(url);tokens.push([u.hostname,options.headers?.Authorization||null]);
   if(u.pathname==='/api/v3/user')return Response.json(user);
   if(u.pathname==='/api/graphql')return Response.json({data:{viewer:{login:'nubi-user',status:null}}});
   if(u.origin===ORIGIN&&u.pathname==='/avatars/u/42')return redirect(AVATARS+'/u/42?v=4');
   if(u.origin===AVATARS)return image();
   return new Response('',{status:404});}});
 const profile=await account.identity({token:'fixture-token'});
 assert.equal(profile.avatar,'data:image/png;base64,'+png.toString('base64'));
 assert.ok(tokens.filter(([host])=>host!=='code.sdsdev.co.kr').every(([,auth])=>auth===null),'no token on the avatars host');
});
