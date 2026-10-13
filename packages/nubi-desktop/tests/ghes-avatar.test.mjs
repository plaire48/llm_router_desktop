import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {GhesAccount,ORIGIN,CLIENT_ID,SECRET_KEY}=require('../../nubi-vscode/src/ghes.cjs');
const {ElectronHost}=require('../electron-app/native-host.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZHcAAAAASUVORK5CYII=','base64');
const photo='data:image/png;base64,'+png.toString('base64');
const user={id:42,login:'nubi-user',name:'누비 사용자',avatar_url:ORIGIN+'/avatars/u/42',html_url:ORIGIN+'/nubi-user'};
function fixture({stored,identity=user,avatar=()=>new Response(png,{headers:{'content-type':'image/png'}}),browserAvatar=()=>new Response('',{status:403})}={}){
 let clock=1000,currentUser=identity;
 const saved=new Map(stored?[[SECRET_KEY,stored]]:[]),calls=[],browserCalls=[];
 const secrets={get:async key=>saved.get(key),store:async(key,value)=>saved.set(key,value),delete:async key=>saved.delete(key)};
 const account=new GhesAccount({secrets,cacheAvatars:true,openExternal:async()=>true,now:()=>clock,waiter:async ms=>{clock+=ms;},
  fetcher:async(url,options)=>{
   calls.push({url,options});const path=new URL(url).pathname;
   if(path==='/login/device/code')return Response.json({device_code:'PRIVATE_DEVICE',user_code:'ABCD-EFGH',verification_uri:ORIGIN+'/login/device',expires_in:900,interval:5});
   if(path==='/login/oauth/access_token')return Response.json({access_token:'PRIVATE_TOKEN',token_type:'bearer'});
   if(path==='/api/v3/user')return Response.json(currentUser);
   return avatar(url,options);
  },avatarFetcher:async(url,options)=>{browserCalls.push({url,options});return browserAvatar(url,options);}});
 return {account,saved,calls,browserCalls,secrets,setUser:value=>{currentUser=value;},advance:ms=>{clock+=ms;}};
}
async function login(f){await f.account.login();await f.account.authorization;assert.equal(f.account.view().connected,true);return f.account.view();}

test('Desktop caches a verified photo in its protected connection record and renders only display identity',async()=>{
 const f=fixture();assert.equal((await login(f)).profile.avatar,photo);
 const cache=JSON.parse(f.saved.get(SECRET_KEY)).avatarCache;
 assert.equal(cache.id,42);assert.equal(cache.image,photo);assert.equal(cache.source.length,64);
 assert.doesNotMatch(JSON.stringify(f.account.view()),/PRIVATE_TOKEN|avatarCache|fetchedAt/);
 const imageCount=f.calls.filter(call=>new URL(call.url).pathname.startsWith('/avatars/')).length;
 await f.account.credential();await f.account.json('/user');
 assert.equal(f.calls.filter(call=>new URL(call.url).pathname.startsWith('/avatars/')).length,imageCount,'repository requests do not refetch recent photos');
 const restored=fixture({stored:f.saved.get(SECRET_KEY),avatar:()=>{throw Error('offline');}});
 restored.advance(5000);
 assert.equal((await restored.account.status()).profile.avatar,photo);
 assert.equal(restored.calls.length,1,'identity is still verified with /user before accepting the saved photo');
 await f.account.logout();assert.equal(f.saved.size,0);assert.equal(f.account.view().profile,null);
});

test('transient refresh and stale-cache network failures keep the last verified photo; explicit refresh replaces it',async()=>{
 let available=true,next=png;
 const f=fixture({avatar:()=>available?new Response(next,{headers:{'content-type':'image/png'}}):new Response('',{status:403})});
 await login(f);available=false;
 assert.equal((await f.account.action('refresh')).profile.avatar,photo);
 const restored=fixture({stored:f.saved.get(SECRET_KEY),avatar:()=>new Response('',{status:403})});restored.advance(600000);
 assert.equal((await restored.account.status()).profile.avatar,photo);
 available=true;next=Buffer.concat([png,Buffer.from('updated')]);
 const refreshed=await f.account.action('refresh');assert.notEqual(refreshed.profile.avatar,photo);
 assert.equal(JSON.parse(f.saved.get(SECRET_KEY)).avatarCache.image,refreshed.profile.avatar);
});

test('advertised external avatars use the same-company fallback without sending credentials outside GHES',async()=>{
 const f=fixture({identity:{...user,avatar_url:'https://avatars.other.invalid/u/42'},avatar:()=>new Response('',{status:401}),browserAvatar:()=>new Response(png,{headers:{'content-type':'image/png'}})});
 assert.equal((await login(f)).profile.avatar,photo);
 assert.equal(f.browserCalls.length,1);assert.equal(new URL(f.browserCalls[0].url).pathname,'/avatars/u/42');
 assert.equal(f.browserCalls[0].options.credentials,'include');assert.equal(f.browserCalls[0].options.headers.Authorization,undefined);
 assert.ok([...f.calls,...f.browserCalls].every(call=>new URL(call.url).origin===ORIGIN));
});

test('photos cannot cross identity or source changes, and malformed cached images never render',async()=>{
 const initial=fixture();await login(initial);const stored=initial.saved.get(SECRET_KEY);
 for(const identity of [{...user,id:43,login:'other'}, {...user,avatar_url:ORIGIN+'/avatars/new-42'}]){
  const f=fixture({stored,identity,avatar:()=>new Response('',{status:404})});
  assert.equal((await f.account.status()).profile.avatar,null);
  assert.equal(JSON.parse(f.saved.get(SECRET_KEY)).avatarCache,undefined);
 }
 for(const image of ['data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,'+Buffer.from('<html>login</html>').toString('base64')]){
  const record=JSON.parse(stored);record.avatarCache.image=image;
  const f=fixture({stored:JSON.stringify(record),avatar:()=>new Response('',{status:404})});
  assert.equal((await f.account.status()).profile.avatar,null);
 }
});

test('logout during photo refresh cannot publish or persist a late image',async()=>{
 const f=fixture();await login(f);let release,entered;
 const started=new Promise(resolve=>{entered=resolve;});
 f.account.fetcher=async(url)=>new URL(url).pathname==='/api/v3/user'?Response.json(user):new Promise(resolve=>{release=resolve;entered();});
 const refresh=f.account.action('refresh');await started;await f.account.logout();release(new Response(png,{headers:{'content-type':'image/png'}}));
 await assert.rejects(refresh,/ghes_session_changed/);
 assert.equal(f.saved.size,0);assert.equal(f.account.view().profile,null);
});

test('Electron host enables the protected photo cache and keeps browser fetch separate from API credentials',()=>{
 const browser=async()=>new Response('',{status:403});
 const host=new ElectronHost({keyStore:{},invoke:async()=>{},avatarFetcher:browser});
 assert.equal(host.account.cacheAvatars,true);assert.equal(host.account.avatarFetcher,browser);host.dispose();
});
