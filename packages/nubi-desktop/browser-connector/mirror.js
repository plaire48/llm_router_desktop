// Human input and the content stream use the paired tab, never a copied profile.
// Frame acknowledgements provide backpressure all the way to the visible canvas.
export function createTabMirror({chrome,send,row,attached}){
 let current=null,queue=Promise.resolve();
 const serial=work=>{const next=queue.then(work);queue=next.catch(()=>{});return next;};
 const cdp=(id,method,params={})=>chrome.debugger.sendCommand({tabId:id},method,params);
 async function reset(stream){
  for(const key of stream.keys.values())await cdp(stream.tabId,'Input.dispatchKeyEvent',{...key,type:'keyUp'}).catch(()=>{});
  stream.keys.clear();
  if(stream.button){await cdp(stream.tabId,'Input.dispatchMouseEvent',{type:'mouseReleased',button:stream.button,x:stream.x||0,y:stream.y||0,clickCount:1}).catch(()=>{});stream.button=null;}
 }
 async function end(stream){
  if(!stream)return;if(current===stream)current=null;
  clearTimeout(stream.timer);await reset(stream);await cdp(stream.tabId,'Page.stopScreencast').catch(()=>{});
  if(stream.resized)await cdp(stream.tabId,'Emulation.clearDeviceMetricsOverride').catch(()=>{});
 }
 const valid=async args=>{
  const stream=current;
  if(!stream||stream.streamId!==args.streamId||String(stream.tabId)!==String(args.tabId)||stream.documentId!==args.documentId)throw Error('browser_mirror_changed');
  await row(stream.tabId,{documentId:stream.documentId,allowPortal:true});
  if(current!==stream)throw Error('browser_mirror_changed');return stream;
 };
 async function dispatch(action,args={}){
  if(action==='mirrorStart')return serial(async()=>{
   if(typeof args.streamId!=='string'||! /^[a-f0-9-]{36}$/.test(args.streamId))throw Error('browser_mirror_invalid');
   const {tab,record}=await row(args.tabId,{documentId:args.documentId,allowPortal:true});
   await end(current);
   if(!attached.has(tab.id)){await chrome.debugger.attach({tabId:tab.id},'1.3');attached.add(tab.id);}
   const stream={streamId:args.streamId,tabId:tab.id,documentId:record.documentId,sequence:0,pending:null,keys:new Map(),manualUntil:0};current=stream;
   try{
    if(args.width!==undefined||args.height!==undefined){
     if(![args.width,args.height].every(x=>Number.isInteger(x)&&x>=100&&x<=8192)||args.width*args.height>12000000)throw Error('browser_mirror_bounds');
     stream.resized=true;await cdp(tab.id,'Emulation.setDeviceMetricsOverride',{width:args.width,height:args.height,deviceScaleFactor:1,mobile:false});
    }
    await cdp(tab.id,'Page.startScreencast',{format:'jpeg',quality:85,maxWidth:1920,maxHeight:1440,everyNthFrame:1});await row(tab.id,{documentId:stream.documentId,allowPortal:true});
   }
   catch(error){await end(stream);throw error;}
   return {started:true,streamId:stream.streamId};
  });
  if(action==='mirrorStop')return serial(async()=>{if(current?.streamId!==args.streamId)return {stopped:false};await end(current);return {stopped:true};});
  if(action==='mirrorAck'){
   const stream=await valid(args);
   if(!stream.pending||stream.pending.sequence!==args.sequence)return {acknowledged:false};
   const frame=stream.pending;stream.pending=null;await cdp(stream.tabId,'Page.screencastFrameAck',{sessionId:frame.sessionId});return {acknowledged:true};
  }
  if(action!=='mirrorInput')throw Error('browser_action_invalid');
  return serial(async()=>{
   const stream=await valid(args),input=args.input||{},kind=input.kind;
   stream.manualUntil=Date.now()+1500;
   const modifiers=Number.isInteger(input.modifiers)&&input.modifiers>=0&&input.modifiers<=15?input.modifiers:0;
   if(kind==='reset'){await reset(stream);return {sent:true};}
   if(kind==='text'){
    if(typeof input.text!=='string'||input.text.length>100000)throw Error('browser_mirror_invalid');
    await cdp(stream.tabId,'Input.insertText',{text:input.text});return {sent:true};
   }
   if(kind==='key'){
    if(!['rawKeyDown','keyUp'].includes(input.type)||typeof input.key!=='string'||input.key.length>80||typeof input.code!=='string'||input.code.length>80)throw Error('browser_mirror_invalid');
    const key={key:input.key,code:input.code,modifiers,windowsVirtualKeyCode:Number.isInteger(input.keyCode)?Math.max(0,Math.min(255,input.keyCode)):0};
    if(input.type==='keyUp')stream.keys.delete(input.code);else stream.keys.set(input.code,key);
    await cdp(stream.tabId,'Input.dispatchKeyEvent',{...key,type:input.type,autoRepeat:input.repeat===true});return {sent:true};
   }
   if(kind==='command'){
    if(!['selectAll','copy','cut','paste','undo','redo'].includes(input.command))throw Error('browser_mirror_invalid');
    // Editing commands target the original tab. Clipboard bytes stay local.
    if(input.command==='paste')throw Error('browser_mirror_invalid');
    if(['copy','cut'].includes(input.command)){
     const read=await cdp(stream.tabId,'Runtime.evaluate',{expression:'String(window.getSelection()?.toString() || (()=>{const e=document.activeElement;return e&&e.type!=="password"&&typeof e.value==="string"?e.value.slice(e.selectionStart||0,e.selectionEnd||0):""})()).slice(0,100000)',returnByValue:true});
     const text=String(read.result?.value||'');
     if(input.command==='cut'&&text)await cdp(stream.tabId,'Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
     if(input.command==='cut'&&text)await cdp(stream.tabId,'Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
     return {text};
    }
    const key={selectAll:['a','KeyA',65,'SelectAll'],undo:['z','KeyZ',90,'Undo'],redo:['y','KeyY',89,'Redo']}[input.command];
    await cdp(stream.tabId,'Input.dispatchKeyEvent',{type:'rawKeyDown',key:key[0],code:key[1],windowsVirtualKeyCode:key[2],modifiers:2,commands:[key[3]]});
    await cdp(stream.tabId,'Input.dispatchKeyEvent',{type:'keyUp',key:key[0],code:key[1],windowsVirtualKeyCode:key[2],modifiers:2});return {sent:true};
   }
   if(!['mouse','wheel','context'].includes(kind)||!Number.isFinite(input.x)||!Number.isFinite(input.y)||input.x<0||input.y<0||input.x>32768||input.y>32768)throw Error('browser_mirror_invalid');
   const viewport=stream.viewport;
   if(!viewport||input.x>viewport.width||input.y>viewport.height)throw Error('browser_mirror_bounds');
   stream.x=input.x;stream.y=input.y;
   if(kind==='wheel'){
    if(!Number.isFinite(input.deltaX)||!Number.isFinite(input.deltaY)||Math.abs(input.deltaX)>10000||Math.abs(input.deltaY)>10000)throw Error('browser_mirror_invalid');
    await cdp(stream.tabId,'Input.dispatchMouseEvent',{type:'mouseWheel',x:input.x,y:input.y,deltaX:input.deltaX,deltaY:input.deltaY,modifiers});return {sent:true};
   }
   if(kind==='context'){
    // Suppress the source browser's native menu, while allowing the site's own
    // contextmenu handlers to run first. A custom site menu stays in the stream.
    await cdp(stream.tabId,'Runtime.evaluate',{expression:'(()=>{window.__nubiMirrorMenu=null;window.addEventListener("contextmenu",e=>{const target=e.composedPath()[0],a=target?.closest?.("a[href]"),editable=!!target?.closest?.("input,textarea,[contenteditable=true]");window.__nubiMirrorMenu={siteHandled:e.defaultPrevented,editable,link:a?.href||""};e.preventDefault()},{once:true})})()'});
    for(const type of ['mousePressed','mouseReleased'])await cdp(stream.tabId,'Input.dispatchMouseEvent',{type,button:'right',x:input.x,y:input.y,clickCount:1,modifiers});
    const result=await cdp(stream.tabId,'Runtime.evaluate',{expression:'(()=>{const value=window.__nubiMirrorMenu;delete window.__nubiMirrorMenu;return value})()',returnByValue:true});
    return {context:result.result?.value||{siteHandled:true}};
   }
   if(!['mousePressed','mouseReleased','mouseMoved'].includes(input.type)||!['none','left','middle','right'].includes(input.button))throw Error('browser_mirror_invalid');
   if(input.type==='mousePressed')stream.button=input.button;if(input.type==='mouseReleased')stream.button=null;
   await cdp(stream.tabId,'Input.dispatchMouseEvent',{type:input.type,button:input.button,x:input.x,y:input.y,buttons:Number.isInteger(input.buttons)?input.buttons&7:0,clickCount:Math.max(0,Math.min(3,input.clickCount||0)),modifiers});return {sent:true};
  });
 }
 function frame(source,method,params){
  if(method!=='Page.screencastFrame')return false;
  const stream=current;
  if(!stream||source.tabId!==stream.tabId){void cdp(source.tabId,'Page.screencastFrameAck',{sessionId:params.sessionId}).catch(()=>{});return true;}
  if(stream.pending){void cdp(source.tabId,'Page.screencastFrameAck',{sessionId:params.sessionId}).catch(()=>{});return true;}
  const data=params.data,metadata=params.metadata||{};
  if(typeof data!=='string'||data.length>1500000||![metadata.deviceWidth,metadata.deviceHeight].every(x=>Number.isFinite(x)&&x>0&&x<=32768)){
   void cdp(source.tabId,'Page.screencastFrameAck',{sessionId:params.sessionId}).catch(()=>{});return true;
  }
  const sequence=++stream.sequence;stream.pending={sequence,sessionId:params.sessionId};
  stream.viewport={width:metadata.deviceWidth,height:metadata.deviceHeight};
  send({type:'mirrorFrame',streamId:stream.streamId,tabId:String(stream.tabId),documentId:stream.documentId,sequence,data,viewport:{width:metadata.deviceWidth,height:metadata.deviceHeight},timestamp:metadata.timestamp});
  return true;
 }
 function invalidate(tabId){if(current&&(tabId===undefined||current.tabId===tabId)){const previous=current;current=null;return serial(()=>end(previous));}return Promise.resolve();}
 return {dispatch,frame,invalidate,active:tabId=>current?.tabId===Number(tabId),interacting:tabId=>current?.tabId===Number(tabId)&&current.manualUntil>Date.now()};
}
