import test from 'node:test';import assert from 'node:assert/strict';
import {openMailBrowserLogin} from '../ui/mail-browser-login.mjs';
test('valid mail session needs no browser or credential request',async()=>{
 const calls=[];const state={connected:true};const result=await openMailBrowserLogin(async(method,args)=>{calls.push({method,...args});return state;});assert.equal(result,state);assert.deepEqual(calls,[{method:'mail',action:'portalSession'}]);
});
test('missing session uses original interactive portal login without credentials',async()=>{
 const calls=[];const result=await openMailBrowserLogin(async(method,args)=>{calls.push({method,...args});return {connected:args.action==='portalLogin'};});assert.equal(result.connected,true);assert.deepEqual(calls,[{method:'mail',action:'portalSession'},{method:'mail',action:'portalLogin'}]);
});
test('cancelled session checks and failed logins never replay authentication',async()=>{
 for(const action of ['portalSession','portalLogin']){const calls=[];await assert.rejects(openMailBrowserLogin(async(_method,args)=>{calls.push(args.action);if(args.action===action)throw Error('mail_cancelled');return {connected:false};}),/mail_cancelled/);assert.equal(calls.length,action==='portalSession'?1:2);}
});

test('browser handoff happens before opening the portal, only for a missing session',async()=>{
 const events=[];const api=async(_method,args)=>{events.push(args.action);return {connected:args.action==='portalLogin'};};
 await openMailBrowserLogin(api,{onBrowserOpen:()=>events.push('dismiss-overlay')});
 assert.deepEqual(events,['portalSession','dismiss-overlay','portalLogin']);
 events.length=0;await openMailBrowserLogin(async()=>({connected:true}),{onBrowserOpen:()=>events.push('unexpected')});assert.deepEqual(events,[]);
});
test('closing the session check never opens a late login tab',async()=>{
 const actions=[];await assert.rejects(openMailBrowserLogin(async(_method,args)=>{actions.push(args.action);return {connected:false};},{isActive:()=>false}),/mail_cancelled/);
 assert.deepEqual(actions,['portalSession']);
});
