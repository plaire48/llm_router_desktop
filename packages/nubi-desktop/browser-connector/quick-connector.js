export function createQuickConnector({chrome,connect,connected}){
 let pending=null;
 const safe=tab=>tab&&!tab.incognito&&/^https?:\/\//.test(tab.url||'')&&!/\/nubi-browser-connect\//.test(tab.url);
 async function clean(value=pending){
  if(!value)return;if(pending===value)pending=null;clearTimeout(value.timer);
  for(const proof of value.proofs){try{const tab=await chrome.tabs.get(proof.id);if(tab.url===proof.url&&tab.windowId===proof.windowId)await chrome.tabs.remove(tab.id);}catch{}}
 }
 async function prepare(sender,message){
  if(pending||connected())throw Error('external_browser_busy');
  const bridge=await chrome.tabs.get(sender.tab.id);if(bridge.url!==sender.url||bridge.incognito)throw Error('external_browser_code_invalid');
  const windows=message.proof?(await chrome.windows.getAll({windowTypes:['normal']})).filter(w=>!w.incognito):[{id:bridge.windowId}];
  if(windows.length>16)throw Error('external_browser_window_limit');
  const value={bridge:bridge.id,owner:sender.url,proofs:[]};pending=value;
  value.timer=setTimeout(()=>void clean(value),20000);
  try{
   for(const window of windows){
    const candidates=await chrome.tabs.query({windowId:window.id});
    // The bridge displaced the last active tab in its own window. lastAccessed
    // selects the user's most recently used tab, never an arbitrary URL match.
    const previous=candidates.find(t=>t.active&&safe(t))||candidates.filter(safe).sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0];
    if(!previous&&!message.url)continue;
    const nonce=crypto.randomUUID(),proof={nonce,windowId:window.id,previous:previous?.id,url:chrome.runtime.getURL('window-proof.html')+'#'+nonce};
    if(message.proof){const tab=await chrome.tabs.create({windowId:window.id,active:true,url:proof.url,...(previous?{openerTabId:previous.id}: {})});proof.id=tab.id;}
    value.proofs.push(proof);
   }
   if(!value.proofs.length)throw Error('external_browser_choose_tab');
   value.url=message.url;return {nonces:value.proofs.map(p=>p.nonce)};
  }catch(error){await clean(value);throw error;}
 }
 async function commit(sender,message){
  const value=pending;if(!value||value.bridge!==sender.tab.id||value.owner!==sender.url)throw Error('external_browser_code_invalid');
  const proof=value.proofs.find(p=>p.nonce===message.nonce);if(!proof)throw Error('dock_window_mismatch');
  try{
   const [selected]=await chrome.tabs.query({windowId:proof.windowId,active:true});
   if(selected?.id!==(proof.id??value.bridge)&&selected?.id!==value.bridge)throw Error('dock_cancelled');
   let tab=proof.previous===undefined?null:await chrome.tabs.get(proof.previous);
   if(tab&&(!safe(tab)||tab.windowId!==proof.windowId))throw Error('browser_tab_missing');
   if(value.url){const url=new URL(value.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('browser_url_invalid');tab=await chrome.tabs.create({windowId:proof.windowId,url:url.href,active:true});
    const end=Date.now()+10000;while(Date.now()<end){tab=await chrome.tabs.get(tab.id);if(tab.status==='complete'&&/^https?:/.test(tab.url||''))break;await new Promise(resolve=>setTimeout(resolve,100));}
   }
   if(!safe(tab))throw Error('external_browser_choose_tab');
   await connect(message.code,tab);
   // Return to the selected original only while our proof/bridge is selected.
   const [active]=await chrome.tabs.query({windowId:proof.windowId,active:true});
   if(active?.id===proof.id||active?.id===value.bridge)await chrome.tabs.update(tab.id,{active:true});
   const bridge=await chrome.tabs.get(value.bridge);if(bridge.url===value.owner)await chrome.tabs.remove(bridge.id);
   return {connected:true};
  }finally{await clean(value);}
 }
 chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id||!sender.tab||sender.frameId!==0||!/^http:\/\/127\.0\.0\.1:\d{1,5}\/nubi-browser-connect\/[a-f0-9]{64}$/.test(sender.url||''))return;
  const work=message.action==='quickPrepare'?prepare(sender,message):message.action==='quickCommit'?commit(sender,message):message.action==='quickCancel'&&pending?.bridge===sender.tab.id?clean():null;
  if(!work)return;void work.then(reply,error=>reply({error:/^[a-z_]+$/.test(error.message)?error.message:'external_browser_connection_failed'}));return true;
 });
 return {clean};
}
