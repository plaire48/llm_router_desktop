import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {expiredSessionDialog,mailDialogPending,installMailSessionDialogs} from '../electron-app/mail-session-dialog.cjs';
const notice={url:'https://www.samsung.net/loginapp/abnormal-logout',type:'alert',message:'사용자 세션이 만료되었습니다. 브라우저를 종료하고 다시 로그인해 주시기 바랍니다.'};
function fixture(){
 const contents=new EventEmitter(),debuggerApi=new EventEmitter(),commands=[];let attached=false;
 Object.assign(debuggerApi,{isAttached:()=>attached,attach:()=>{attached=true;},sendCommand:async(method,args)=>{commands.push({method,args});},detach:()=>{attached=false;debuggerApi.emit('detach');}});
 contents.debugger=debuggerApi;installMailSessionDialogs(contents);
 return {contents,commands,emit:(method,args)=>debuggerApi.emit('message',{},method,args)};
}
test('only known portal session-expired alerts require navigation after manual confirmation',()=>{
 assert(expiredSessionDialog(notice));
 for(const change of [{type:'confirm'},{type:'prompt'},{message:'로그인 정보를 저장할까요?'},{url:'https://www.samsung.net.evil.test/loginapp/logout'},{url:'https://user:password@www.samsung.net/loginapp/logout'},{url:'https://www.samsung.net:8443/loginapp/logout'}])assert.equal(expiredSessionDialog({...notice,...change}),false);
});
test('native dialogs stay manual and block probes through the expiry redirect gap',()=>{
 const {contents,commands,emit}=fixture();
 assert.equal(mailDialogPending(contents),false);
 emit('Page.javascriptDialogOpening',notice);assert.equal(mailDialogPending(contents),true);
 emit('Page.javascriptDialogClosed',{result:true});assert.equal(mailDialogPending(contents),true);
 contents.emit('did-start-navigation',{},'https://www.samsung.net/loginapp/login',true,true);assert.equal(mailDialogPending(contents),true,'hash changes do not prove login navigation');
 contents.emit('did-start-navigation',{},'https://www.samsung.net/loginapp/login',false,true);assert.equal(mailDialogPending(contents),false);
 assert.deepEqual(commands,[{method:'Page.enable',args:undefined}],'never auto-confirm or collect Network/Runtime data');
 installMailSessionDialogs(contents);assert.equal(contents.debugger.listenerCount('message'),1);
});
test('unrelated confirmation remains manual and does not require a redirect',()=>{
 const {contents,commands,emit}=fixture();emit('Page.javascriptDialogOpening',{...notice,type:'confirm',message:'작업을 진행할까요?'});
 assert.equal(mailDialogPending(contents),true);emit('Page.javascriptDialogClosed',{result:false});assert.equal(mailDialogPending(contents),false);
 assert.equal(commands.length,1);contents.debugger.detach();assert.equal(contents.debugger.listenerCount('message'),0);assert.equal(contents.listenerCount('did-start-navigation'),0);
});
