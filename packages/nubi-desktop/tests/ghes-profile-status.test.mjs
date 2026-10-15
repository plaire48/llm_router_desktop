import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {DesktopGhesAccount,displayStatus}=createRequire(import.meta.url)('../electron-app/ghes-profile-status.cjs');
function fixture(){let time=1000,calls=0,reply={data:{viewer:{login:'alice',status:{emoji:':smile:',emojiHTML:'<g-emoji alias="smile">😄</g-emoji>',message:'집중 중'}}}};const account=new DesktopGhesAccount({secrets:{get:async()=>null,delete:async()=>{}},now:()=>time,fetcher:async(url,options)=>{calls++;assert.equal(url,'https://code.sdsdev.co.kr/api/graphql');assert.equal(options.credentials,'omit');assert.match(JSON.parse(options.body).query,/^query /);return Response.json(reply);}});Object.assign(account,{loaded:true,state:'connected',record:{token:'fixture-only'},profile:{id:1,login:'alice',name:'Alice'}});return {account,calls:()=>calls,set:value=>reply=value,advance:()=>time+=61000};}
test('status accepts only a single Unicode emoji and never renders server HTML',()=>{
 assert.equal(displayStatus({emoji:'😊',message:'업무 중'}).emoji,'😊');assert.equal(displayStatus({emoji:':smile:',emojiHTML:'<g-emoji>&#x1f604;</g-emoji>'}).emoji,'😄');
 for(const value of [{emoji:'hi 😊'},{emoji:'😊😊'},{emoji:':smile:',emojiHTML:'<img src="bad">'},{emoji:'😊',expiresAt:'2000-01-01'}])assert.equal(displayStatus(value),null);
});
test('status is account-scoped, cached and cleared after removal or unsupported GraphQL',async()=>{
 const f=fixture();assert.equal((await f.account.status()).profile.status.emoji,'😄');await f.account.status();assert.equal(f.calls(),1);
 f.advance();f.set({data:{viewer:{login:'alice',status:null}}});assert.equal((await f.account.status()).profile.status,null);
 f.advance();f.set({errors:[{message:'unsupported'}]});assert.equal((await f.account.status()).connected,true);assert.equal(f.account.view().profile.status,null);
 f.advance();f.set({data:{viewer:{login:'other',status:{emoji:'😊'}}}});assert.equal((await f.account.status()).profile.status,null);
});
test('a late status response cannot restore a logged-out profile',async()=>{
 const f=fixture();let finish;f.account.fetcher=()=>new Promise(resolve=>finish=resolve);const pending=f.account.readProfileStatus();await f.account.logout();finish(Response.json({data:{viewer:{login:'alice',status:{emoji:'😊'}}}}));await pending;assert.equal(f.account.view().profile,null);
});

test('custom status survives status/view/cache reads and expires without a new request',async()=>{
 const f=fixture();f.set({data:{viewer:{login:'alice',status:{emoji:':shipit:',emojiHTML:'<img src="https://code.sdsdev.co.kr/images/icons/emoji/shipit.png">',message:'배포 중',expiresAt:new Date(61000).toISOString()}}}});
 const first=(await f.account.status()).profile.status;
 assert.equal(first.image,'https://code.sdsdev.co.kr/images/icons/emoji/shipit.png');
 assert.equal(first.name,'shipit');assert.equal(first.emoji,'');
 assert.deepEqual(f.account.view().profile.status,first);
 assert.deepEqual((await f.account.status()).profile.status,first);assert.equal(f.calls(),1);
 f.advance();assert.equal(f.account.view().profile.status,null);
});
