import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
const main=await readFile(new URL('../electron-app/main.cjs',import.meta.url),'utf8'),start=main.indexOf('const dispatch=async('),end=main.indexOf('\n const terminalLog=boundedLog(',start);assert(start>=0&&end>start);
function fixture(method='portal',connected=false){
 const calls=[],events=[],state={connectionMethod:method,connected},portalState={connected,connecting:false,checking:false};
 const invoke=async(_method,args)=>{calls.push({...args});if(args.action==='selectMethod')state.connectionMethod=args.method;if(args.action==='connect')state.connected=true;return {...state};};
 const mailPortal={status:()=>({...portalState}),disconnect:async()=>{calls.push({action:'portalDisconnect'});portalState.connected=false;},connect:async()=>{calls.push({action:'portalConnect'});throw Error('external_browser_connection_required');}};
 const browserRouter={mode:'internal',externalFocus:false,setMode:async mode=>{calls.push({action:'setBrowserMode',mode});browserRouter.mode=mode;},configuration:()=>({mode:browserRouter.mode})};
 const dispatch=vm.runInNewContext(main.slice(start,end)+'\ndispatch',{installingUpdate:false,DESKTOP_FEATURES:{computerUse:false},mailPortal,invoke,portalMailStatus:async snapshot=>snapshot||{...state},mailLoginNotices:{reset(){},clear(){}},hostEvent:event=>events.push(event),browserRouter,browserContentPort:{request:async args=>({action:args.action})}});
 return {dispatch,calls,events,state};
}
test('main keeps a live portal on repeated selection and switches to independent POP3',async()=>{
 const f=fixture('portal',true);await f.dispatch('mail',{action:'selectMethod',method:'portal'});assert.equal(f.calls.filter(c=>c.action==='portalDisconnect').length,0);
 await f.dispatch('mail',{action:'selectMethod',method:'pop3'});assert.equal(f.calls.filter(c=>c.action==='portalDisconnect').length,1);
 const result=await f.dispatch('mail',{action:'connect',serverProfile:'company',user:'synthetic',password:'synthetic'});assert.equal(result.connectionMethod,'pop3');assert.equal(f.calls.filter(c=>c.action==='connect').length,1);
});
test('main forwards cancel to a POP3 connection and preserves request binding',async()=>{
 const f=fixture('pop3');await f.dispatch('mail',{action:'cancelConnect',requestId:'synthetic-request'});assert(f.calls.some(c=>c.action==='cancelConnect'&&c.requestId==='synthetic-request'));
});
test('portal login exposes the external right content before requesting a paired browser',async()=>{
 const f=fixture();const result=await f.dispatch('mail',{action:'portalLogin'});assert.equal(result.__nubiError,'external_browser_connection_required');assert(f.calls.some(c=>c.action==='setBrowserMode'&&c.mode==='external'));assert(f.events.some(e=>e.type==='external_browser_opened'));assert(!f.events.some(e=>e.type==='mail_portal_failed'));
});
test('browser content requests are restricted to the trusted Electron dispatch surface',async()=>{
 const f=fixture();assert.equal((await f.dispatch('browserMirror',{action:'start'})).action,'start');assert.equal((await f.dispatch('browserMirror',{action:'start'},'web')).__nubiError,'browser_desktop_only');
});
