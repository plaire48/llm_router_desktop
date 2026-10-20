// OS/network facts only. No credentials, page data or model instructions.
function watchWikiLifecycle({powerMonitor,net,invoke,owner,schedule=setInterval,cancel=clearInterval}){
 let alive=true,suspended=false,lastOnline=net.isOnline(),lastRoot=owner();
 const send=event=>{const expectedRoot=owner();if(alive&&expectedRoot)void Promise.resolve().then(()=>invoke('wikiLifecycle',{event,expectedRoot})).catch(()=>{});};
 const suspend=()=>{if(suspended)return;suspended=true;send('suspend');};
 const resume=()=>{if(!suspended)return;suspended=false;send('resume');};
 const poll=()=>{if(!alive)return;const online=net.isOnline(),root=owner();if(online!==lastOnline||root!==lastRoot&&!online)send(online?'online':'offline');lastOnline=online;lastRoot=root;};
 powerMonitor.on('suspend',suspend);powerMonitor.on('resume',resume);
 const timer=schedule(poll,5000);timer?.unref?.();if(!lastOnline)send('offline');
 return()=>{if(!alive)return;alive=false;cancel(timer);powerMonitor.removeListener('suspend',suspend);powerMonitor.removeListener('resume',resume);};
}
module.exports={watchWikiLifecycle};
