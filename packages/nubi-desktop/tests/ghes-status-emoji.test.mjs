import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {DesktopGhesAccount,displayStatus,RECHECK_MS}=require('../electron-app/ghes-profile-status.cjs');
const {SECRET_KEY,CLIENT_ID,ORIGIN}=require('../../nubi-vscode/src/ghes.cjs');

test('status emoji: Unicode from GitHub HTML, common shortcodes, custom emoji as a company image only',()=>{
 assert.equal(displayStatus({emoji:':coffee:',emojiHTML:'<div><g-emoji class="g-emoji" alias="coffee" fallback-src="https://code.sdsdev.co.kr/images/icons/emoji/unicode/2615.png">☕</g-emoji></div>',message:'휴식'}).emoji,'☕');
 assert.equal(displayStatus({emoji:':house_with_garden:'}).emoji,'🏡','a shortcode without HTML uses the common map');
 assert.equal(displayStatus({emoji:':unknown_custom:'}),null);
 const custom=displayStatus({emoji:':shipit:',emojiHTML:'<div><img class="emoji" title=":shipit:" alt=":shipit:" src="https://code.sdsdev.co.kr/images/icons/emoji/shipit.png?v=8&amp;x=1" height="20" width="20" align="absmiddle"></div>',message:'배포 중'});
 assert.deepEqual(custom,{emoji:'',image:'https://code.sdsdev.co.kr/images/icons/emoji/shipit.png?v=8&x=1',name:'shipit',message:'배포 중'});
 assert.equal(displayStatus({emoji:':shipit:',emojiHTML:'<img src="https://evil.example/x.png">'}),null,'images outside the company hosts are dropped');
 assert.equal(displayStatus({emoji:':shipit:',emojiHTML:'<img src="javascript:alert(1)">'}),null);
 assert.equal(displayStatus({emoji:':smile:',emojiHTML:'<img src="bad">'}),null,'an HTML image never falls back to a guessed shortcode');
 assert.equal(displayStatus({emoji:'<b>😊</b>'}),null);
});

test('a partial GraphQL answer still shows the status',async()=>{
 const account=new DesktopGhesAccount({secrets:{get:async()=>null,delete:async()=>{}},now:()=>1000,fetcher:async()=>Response.json({data:{viewer:{login:'alice',status:{emoji:'🎯',message:'집중'}}},errors:[{message:'Some other field'}]})});
 Object.assign(account,{loaded:true,state:'connected',record:{token:'fixture-only'},profile:{id:1,login:'alice',name:'Alice'}});
 assert.deepEqual((await account.status()).profile.status,{emoji:'🎯',message:'집중'});
});

test('an unreadable key store becomes a re-checkable state, and passing failures re-check by themselves',async()=>{
 let time=1000,readable=false,online=false;
 const record=JSON.stringify({host:ORIGIN,clientId:CLIENT_ID,token:'fixture-token'});
 const account=new DesktopGhesAccount({now:()=>time,
  secrets:{get:async key=>{assert.equal(key,SECRET_KEY);if(!readable)throw Error('secret_unavailable');return record;},store:async()=>{},delete:async()=>{}},
  fetcher:async url=>{if(!online)throw TypeError('fetch failed');const path=new URL(url).pathname;if(path==='/api/v3/user')return Response.json({id:7,login:'kim',name:'김'});if(path==='/api/graphql')return Response.json({data:{viewer:{login:'kim',status:null}}});return new Response('',{status:404});}});
 let view=await account.status();
 assert.equal(view.state,'attention');assert.equal(view.error,'ghes_storage_read');
 readable=true;time+=RECHECK_MS-1;assert.equal((await account.status()).state,'attention','not before the re-check interval');
 time+=1;view=await account.status();
 assert.equal(view.state,'attention');assert.equal(view.error,'ghes_network','the store now reads; the network is still down');
 online=true;time+=RECHECK_MS;view=await account.status();
 assert.equal(view.connected,true);assert.equal(view.profile.login,'kim');assert.equal(view.error,null);
});

test('a failure that needs the person (expired login) is not retried in the background',async()=>{
 let time=1000,userCalls=0;
 const account=new DesktopGhesAccount({now:()=>time,secrets:{get:async()=>JSON.stringify({host:ORIGIN,clientId:CLIENT_ID,token:'fixture-token'}),store:async()=>{},delete:async()=>{}},
  fetcher:async()=>{userCalls++;return new Response('',{status:401});}});
 assert.equal((await account.status()).error,'ghes_session_expired');time+=RECHECK_MS*3;
 const view=await account.status();assert.equal(view.state,'guest');assert.equal(userCalls,1);
});
