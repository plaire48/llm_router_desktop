import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {AuthFlow,displayAddress,isSamlAddress,observeSession}=require('../electron-app/browser-auth-flow.cjs');
test('SAML display redacts binding values but leaves actual navigation untouched',()=>{
 const url='https://example.test/saml?SAMLRequest=secret&RelayState=private&Signature=signed&keep=1#SAMLResponse=assertion';
 assert.equal(displayAddress(url),'https://example.test/saml?keep=1');assert(isSamlAddress(url));
 assert.equal(displayAddress('https://example.test/?SAMLart=secret&code=hidden'),'https://example.test/');
 assert(!isSamlAddress('https://example.test/report'));
});
test('metadata records POST and redirect without body, headers or URLs',()=>{
 const flow=new AuthFlow();flow.request({id:1,url:'https://example.test/saml',method:'POST',uploadData:'SECRET',headers:{cookie:'SECRET'}});
 flow.redirect({id:1,statusCode:307,method:'POST',redirectURL:'https://other.test/saml?token=SECRET'});
 flow.request({id:1,url:'https://other.test/saml',method:'POST'});flow.complete({id:1,statusCode:502,method:'POST'});
 assert.deepEqual(flow.snapshot().failure,{stage:'post',code:'http_error',httpStatus:502});
 const safe=JSON.stringify(flow.snapshot());assert(!/SECRET|https|headers|uploadData/.test(safe));
 const child=new AuthFlow(flow);assert.equal(child.started,flow.started);child.request({id:2,url:'https://other.test/return',method:'GET'});assert.equal(child.stage,'return');
 assert.equal(flow.events.length,3);assert.equal(child.events.length,4);
});
test('old completions cannot replace current navigation; trace is bounded and clears on retry',()=>{
 const flow=new AuthFlow();flow.request({id:1,url:'https://example.test/saml',method:'GET'});flow.request({id:2,url:'https://example.test/saml',method:'GET'});flow.complete({id:1,statusCode:502});assert.equal(flow.failure,null);
 for(let i=0;i<30;i++)flow.redirect({id:2,statusCode:302});assert.equal(flow.events.length,16);
 flow.fail('epsso_request_missing');flow.request({id:3,url:'https://example.test/saml',method:'GET'});assert.equal(flow.failure,null);assert.equal(flow.events.length,1);
});
test('shared-session observer ignores subframes and other tabs and releases only at last close',()=>{
 const listeners={},session={webRequest:Object.fromEntries(['onBeforeRequest','onBeforeRedirect','onCompleted'].map(name=>[name,handler=>listeners[name]=handler]))};
 const a=new AuthFlow(),b=new AuthFlow(),stopA=observeSession(session,{id:10},a,()=>{}),stopB=observeSession(session,{id:11},b,()=>{});
 let continued=0;const event={id:1,webContentsId:10,resourceType:'mainFrame',url:'https://example.test/saml',method:'POST'};
 listeners.onBeforeRequest(event,()=>continued++);listeners.onBeforeRequest({...event,resourceType:'subFrame'},()=>continued++);listeners.onBeforeRequest({...event,webContentsId:99},()=>continued++);
 assert.equal(continued,3);assert.equal(a.events.length,1);assert.equal(b.events.length,0);stopA();assert.equal(typeof listeners.onCompleted,'function');stopB();assert.equal(listeners.onCompleted,null);
});
test('a later ordinary navigation is not mislabeled as an SSO failure',()=>{
 const flow=new AuthFlow();flow.request({id:1,url:'https://example.test/saml',method:'GET'});flow.request({id:2,url:'https://example.test/home',method:'GET'});flow.complete({id:2,statusCode:200});assert(flow.settled);
 const ordinaryChild=new AuthFlow(flow);assert.equal(ordinaryChild.active,false);
 flow.request({id:3,url:'https://example.test/missing',method:'GET'});flow.complete({id:3,statusCode:404});assert.equal(flow.snapshot(),null);
});
