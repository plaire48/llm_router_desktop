import {randomUUID} from 'node:crypto';
// Only a fixed source-sync operation crosses this bridge. Credentials stay in
// Electron main; neither commands nor authentication values cross to the worker.
export function installWikiGitBridge(service,channel=process){
 if(typeof channel.send!=='function')return;
 const pending=new Map();
 const finish=(id,error,result)=>{const item=pending.get(id);if(!item)return;pending.delete(id);clearTimeout(item.timer);item.signal?.removeEventListener('abort',item.abort);error?item.reject(Error(error)):item.resolve(result);};
 channel.on('message',message=>{const reply=message?.wikiGitReply;if(!reply||!pending.has(reply.id))return;finish(reply.id,reply.error&&(/^[a-z_]{3,60}$/.test(reply.error)?reply.error:'git_pull_failed'),reply.result);});
 channel.on('disconnect',()=>{for(const id of pending.keys())finish(id,'host_disconnected');});
 service.syncWikiSources=(root,{signal}={})=>new Promise((resolve,reject)=>{
  const id=randomUUID(),abort=()=>{channel.send({wikiGitCancel:{id}});finish(id,'wiki_refresh_cancelled');};
  const timer=setTimeout(()=>{channel.send({wikiGitCancel:{id}});finish(id,'git_timeout');},190000);
  pending.set(id,{resolve,reject,timer,signal,abort});signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted){abort();return;}
  channel.send({wikiGitRequest:{id,root}},error=>{if(error)finish(id,'host_disconnected');});
 });
}
