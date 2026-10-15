import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {recoverModel} from '../../../extensions/aipro-chat/model-recovery.js';
import {WIKI_MODEL_WAIT_POLICY} from '../runtime/wiki-update.mjs';

test('Wiki activity continues beyond five minutes, while genuine silence pauses once',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 let activity,finish,calls=0;const waiting=[];
 const pending=recoverModel(async ctx=>{calls++;activity=ctx.activity;return new Promise(resolve=>finish=resolve);},{...WIKI_MODEL_WAIT_POLICY,signal:new AbortController().signal,onSlow:()=>waiting.push('slow'),onResumed:()=>waiting.push('resumed')});
 while(!activity)await turn();
 for(let minute=0;minute<8;minute++){t.mock.timers.tick(60000);activity();}
 assert.equal(calls,1);finish('complete');assert.equal(await pending,'complete');assert(waiting.includes('slow'));assert(waiting.includes('resumed'));
 let started=false;calls=0;
 const silent=recoverModel(async()=>{started=true;calls++;return new Promise(()=>{});},{...WIKI_MODEL_WAIT_POLICY,signal:new AbortController().signal});
 const rejected=assert.rejects(silent,/model_timeout/);while(!started)await turn();
 t.mock.timers.tick(599999);await turn();assert.equal(calls,1);
 t.mock.timers.tick(1);await rejected;assert.equal(calls,1,'a ten-minute silent call is not repeated automatically');
});

test('Wiki waiting remains immediately cancellable',async()=>{
 const controller=new AbortController();let started=false;
 const pending=recoverModel(async()=>{started=true;return new Promise(()=>{});},{...WIKI_MODEL_WAIT_POLICY,signal:controller.signal});
 const rejected=assert.rejects(pending,/cancelled/);while(!started)await turn();controller.abort();await rejected;
});
