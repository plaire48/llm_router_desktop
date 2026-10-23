import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {mailSourceStatus}=require('../electron-app/mail-source-status.cjs');

// Mail comes in through 1. Knox Desktop Message or 2. POP3 (user decision 2026-10-23). With the portal switched off the
// host neither restores a portal session nor accepts a portal login, and a POP3 refresh checks POP3, not the portal.
async function hostDispatch(){
 const main=await readFile('electron-app/main.cjs','utf8');const start=main.indexOf('const dispatch=async('),end=main.indexOf('\n const terminalLog=boundedLog(',start);assert(start>=0&&end>start);
 const portalCalls=[],hostCalls=[];
 const mailPortal=new Proxy({status:()=>({connected:false,connecting:false,checking:false,folders:[],fallback:null})},{get(target,name){if(name in target)return target[name];if(typeof name!=='string'||name==='then')return undefined;return async()=>{portalCalls.push(name);return {};};}});
 const invoke=async(_method,args)=>{hostCalls.push(args.action);if(args.action==='connect')hostCalls.connect=args;return {connectionMethod:'pop3',connected:true,serverProfile:'company',protocol:'pop3',error:null,folders:[],desktop:{connected:false}};};
 const statusLine=main.split('\n').find(line=>line.startsWith('async function portalMailStatus('));assert(statusLine);
 const dispatch=vm.runInNewContext(statusLine+'\n'+main.slice(start,end)+'\ndispatch',{installingUpdate:false,DESKTOP_FEATURES:{computerUse:false,mailPortal:false},invoke,mailPortal,mailSourceStatus,mailLoginNotices:{reset(){},clear(){}},hostEvent(){},browserDock:null});
 return {dispatch,portalCalls,hostCalls};
}
test('with the portal off, a portal login is refused before anything opens',async()=>{
 const {dispatch,portalCalls}=await hostDispatch();
 for(const action of ['portalLogin','portalSession']){const result=await dispatch('mail',{action,requestId:'synthetic'});assert.equal(result.__nubiError,'mail_portal_off',action);}
 assert.deepEqual(portalCalls,[]);
});
test('with the portal off, reading mail status does not restore a portal session',async()=>{
 const {dispatch,portalCalls}=await hostDispatch();
 const status=await dispatch('mail',{action:'status'});assert.equal(status.protocol,'pop3');assert.deepEqual(portalCalls,[]);
});
test('a POP3 refresh from the mail screen checks POP3 instead of the portal',async()=>{
 const {dispatch,portalCalls,hostCalls}=await hostDispatch();
 await dispatch('mail',{action:'portalSync'});assert(hostCalls.includes('check'));assert.deepEqual(portalCalls,[]);
});
test('mail source status skips the portal entirely when it is off',async()=>{
 let restored=0;const portal={restore(){restored++;},status:()=>({connected:false,connecting:false,checking:false,folders:[]})};
 const status=await mailSourceStatus({snapshot:{connected:false,serverProfile:'company',folders:[],desktop:{connected:false,connecting:false,checking:false}},invoke:async()=>({}),portal,portalEnabled:false});
 assert.equal(restored,0);assert.notEqual(status.protocol,'portal');assert.equal(status.portal.connected,false);
});
test('with the portal off, POP3 connects directly and passes the 아이디 기억 choice to the mail runtime',async()=>{
 const {dispatch,portalCalls,hostCalls}=await hostDispatch();
 const status=await dispatch('mail',{action:'connect',requestId:'synthetic',serverProfile:'company',user:'synthetic-user',password:'synthetic-only-password',rememberUser:false});
 assert.equal(status.__nubiError,undefined,status.__nubiError);assert.equal(hostCalls.connect.rememberUser,false);assert.equal(hostCalls.connect.user,'synthetic-user');assert.deepEqual(portalCalls,[]);
});
