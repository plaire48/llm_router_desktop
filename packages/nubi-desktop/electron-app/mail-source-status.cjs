// Connection method is explicit. A status read never switches collection
// methods or restores an unrelated portal session.
async function mailSourceStatus({snapshot,invoke,portal,includeMessages=true}){
 const status=snapshot||await invoke('mail',{action:'status',includeMessages});
 const method=status.connectionMethod||(status.desktop?.mode==='desktop'?'desktop':status.serverProfile==='company'&&status.connected?'pop3':'portal');
 if(method==='desktop'){
  const source=status.desktop;
  const localError=/^mail_(?:portal|auth|gmail|tls|dns|connection|uidl)/.test(status.error||'')?null:status.error;
  return {...status,connectionMethod:'desktop',protocol:'desktop',serverProfile:'desktop',connected:source.connected,connecting:source.connecting,checking:source.checking,requiresStorageSetup:status.intakeConfigured===false,fallback:null,error:status.encryption?.migration?.state==='failed'?status.encryption.migration.error:source.error||localError,portal:{connected:false,connecting:false,checking:false,connectionState:'disconnected'},progress:{...status.progress,stage:source.connecting?'connecting':source.checking?'checking':!source.connected&&!status.localCount?'disconnected':status.progress.stage}};
 }
 if(method==='pop3')return {...status,connectionMethod:'pop3',protocol:'pop3',serverProfile:'company',portal:{connected:false,connecting:false,checking:false,connectionState:'disconnected'},fallback:null};
 void portal.restore();const current=portal.status();
 return {fallback:current.fallback,...status,connectionMethod:'portal',protocol:'portal',serverProfile:'portal',connected:current.connected,connecting:current.connecting,checking:current.checking,error:current.error||status.error,folders:current.folders.length?current.folders:status.folders,portal:current,progress:{...status.progress,stage:current.connecting?'connecting':current.checking?'checking':!current.connected&&!status.localCount?'disconnected':status.progress.stage,lastCheckedAt:current.lastCheckedAt}};
}
module.exports={mailSourceStatus};
