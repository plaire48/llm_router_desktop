// Local archive collection is the default. Reading its status must never start
// portal session restoration or turn a stale portal error into a local failure.
async function mailSourceStatus({snapshot,invoke,portal,includeMessages=true,portalEnabled=true}){
 const status=snapshot||await invoke('mail',{action:'status',includeMessages});
 if(status.desktop?.mode==='desktop'){
  const source=status.desktop;
  const localError=/^mail_(?:portal|auth|gmail|tls|dns|connection|uidl)/.test(status.error||'')?null:status.error;
  return {...status,protocol:'desktop',serverProfile:'desktop',connected:source.connected,connecting:source.connecting,checking:source.checking,requiresStorageSetup:false,fallback:null,error:status.encryption?.migration?.state==='failed'?status.encryption.migration.error:source.error||localError,portal:{connected:false,connecting:false,checking:false,connectionState:'disconnected'},progress:{...status.progress,stage:source.connecting?'connecting':source.checking?'checking':!source.connected&&!status.localCount?'disconnected':status.progress.stage}};
 }
 // With the portal off (user decision 2026-10-23) only POP3 remains here; no portal session is restored or reported.
 if(portalEnabled===false)return {...status,protocol:'pop3',fallback:null,portal:{connected:false,connecting:false,checking:false,connectionState:'disconnected'}};
 void portal.restore();const current=portal.status();
 if(status.serverProfile==='company'&&status.connected&&!current.connected&&!current.connecting)return {...status,protocol:'pop3',portal:current,fallback:null};
 return {fallback:current.fallback,...status,protocol:'portal',serverProfile:'portal',connected:current.connected,connecting:current.connecting,checking:current.checking,error:current.error||status.error,folders:current.folders.length?current.folders:status.folders,portal:current,progress:{...status.progress,stage:current.connecting?'connecting':current.checking?'checking':!current.connected&&!status.localCount?'disconnected':status.progress.stage,lastCheckedAt:current.lastCheckedAt}};
}
module.exports={mailSourceStatus};
