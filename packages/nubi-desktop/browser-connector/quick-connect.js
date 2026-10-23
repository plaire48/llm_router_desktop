// Runs only on the app's one-use loopback page, in the extension isolated world.
void(async()=>{
 const status=document.getElementById('status'),tell=text=>{if(status)status.textContent=text;};
 const send=async value=>{const result=await chrome.runtime.sendMessage(value);if(result?.error)throw Error(result.error);return result;};
 try{
  const response=await fetch(location.href+'/config',{cache:'no-store'});if(!response.ok)throw Error('expired');const config=await response.json();
  tell('열린 업무 탭을 확인하고 있어요.');const prepared=await send({action:'quickPrepare',proof:config.proof,url:config.url});
  let nonce=prepared.nonces[0];
  if(config.proof){let result;for(let i=0;i<15;i++){const resolved=await fetch(location.href+'/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(prepared.nonces)});if(resolved.ok){result=await resolved.json();break;}await new Promise(resolve=>setTimeout(resolve,100));}if(!result?.nonce)throw Error('dock_window_mismatch');nonce=result.nonce;}
  await send({action:'quickCommit',nonce,code:config.code});
 }catch(error){void send({action:'quickCancel'}).catch(()=>{});tell(({external_browser_choose_tab:'연결할 업무 페이지를 연 뒤 누비에서 다시 연결해 주세요.',external_browser_busy:'이미 연결 중이거나 연결된 브라우저가 있어요. 누비에서 연결 상태를 확인해 주세요.',dock_window_mismatch:'끌어놓은 창을 확인하지 못했어요. 같은 브라우저의 기본 프로필인지 확인한 뒤 다시 연결해 주세요.'})[error.message]||'연결하지 못했어요. 누비에서 다시 연결을 눌러 주세요.');}
})();
