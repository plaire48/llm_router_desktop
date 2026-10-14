// A capability URL for one WebContents only. No app-wide remote-debugging port.
const {WebSocketServer}=require('ws');
const {randomUUID}=require('node:crypto');
async function connectTab(row){
 const wc=row.view.webContents;
 if(row.authentication||row.companyLogin||row.session)throw Error('browser_auth_protected');
 if(wc.isDestroyed())throw Error('browser_tab_missing');
 if(wc.debugger.isAttached())throw Error('browser_debugger_busy');
 wc.debugger.attach('1.3');
 let targetInfo;try{({targetInfo}=await wc.debugger.sendCommand('Target.getTargetInfo'));}catch(error){wc.debugger.detach();throw error;}
 const secret=randomUUID(),sessionId='nubi-page',targetId=targetInfo.targetId;
 const server=new WebSocketServer({host:'127.0.0.1',port:0,path:'/'+secret,maxPayload:2*1024*1024,verifyClient:({origin})=>!origin});
 try{await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});}catch(error){wc.debugger.detach();throw error;}
 let client,closed=false;
 const info=()=>({targetId,type:'page',title:wc.getTitle(),url:wc.getURL(),attached:true,browserContextId:'nubi-tab'});
 const send=value=>{if(client?.readyState===1)client.send(JSON.stringify(value));};
 const onMessage=(_event,method,params,childSession)=>{
  // The agent needs the DOM, not application console messages or exception data.
  if(['Log.entryAdded','Runtime.consoleAPICalled','Runtime.exceptionThrown'].includes(method))return;
  send({method,params,sessionId:childSession||sessionId});
 };
 wc.debugger.on('message',onMessage);
 const close=()=>{if(closed)return;closed=true;wc.debugger.removeListener('message',onMessage);wc.removeListener('destroyed',close);wc.debugger.removeListener('detach',close);client?.terminate();server.close();if(!wc.isDestroyed()&&wc.debugger.isAttached())wc.debugger.detach();};
 wc.once('destroyed',close);wc.debugger.once('detach',close);
 server.on('connection',socket=>{
  if(client){socket.close();return;}client=socket;socket.on('error',()=>{});socket.on('close',close);
  socket.on('message',async bytes=>{
   let message;try{message=JSON.parse(String(bytes));}catch{return socket.close();}
   const {id,method,params={},sessionId:child}=message; if(process.env.NUBI_PLAYWRIGHT_DIAG==='1')console.log('CDP',method,!!child);
   try{
    if(closed||wc.isDestroyed())throw Error('browser_tab_missing');
    let result;
    if(!child){
     if(method==='Browser.getVersion')result={protocolVersion:'1.3',product:'Chrome/'+process.versions.chrome,userAgent:wc.getUserAgent(),revision:'nubi'};
     else if(method==='Target.setAutoAttach'){if(params.autoAttach)send({method:'Target.attachedToTarget',params:{sessionId,targetInfo:info(),waitingForDebugger:false}});result={};}
     else if(method==='Target.getTargetInfo')result={targetInfo:info()};
     else if(method==='Target.getTargets')result={targetInfos:[info()]};
     else if(['Browser.setDownloadBehavior','Target.setDiscoverTargets'].includes(method))result={};
     else throw Error('browser_scope');
    }else{
     // Browser/global storage and target creation are never forwarded from a page.
     if(method.startsWith('Browser.')||method.startsWith('Storage.')||['Target.createTarget','Target.createBrowserContext'].includes(method))throw Error('browser_scope');
     if(method==='Page.navigate'&&!/^https?:\/\//.test(params.url||''))throw Error('browser_url_invalid');
     result=child===sessionId?await wc.debugger.sendCommand(method,params):await wc.debugger.sendCommand(method,params,child);
    }
    send({id,...(child?{sessionId:child}:{}),result});
   }catch(error){if(process.env.NUBI_PLAYWRIGHT_DIAG==='1')console.log('CDP failed',method,error.message);send({id,...(child?{sessionId:child}:{}),error:{message:error.message}});}
  });
 });
 return {get closed(){return closed;},endpoint:`ws://127.0.0.1:${server.address().port}/${secret}`,close};
}
module.exports={connectTab};
