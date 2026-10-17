const nonce=location.hash.slice(1);
if(/^[a-f0-9-]{36}$/.test(nonce)){
 document.title='Nubi window '+nonce;
 // Self-cleanup still works if the service worker is suspended or disconnected.
 setTimeout(async()=>{const tab=await chrome.tabs.getCurrent();if(tab?.url===location.href)await chrome.tabs.remove(tab.id);},11000);
}
