import {randomUUID} from 'node:crypto';

export function workspacePageUrl(value){
  if(typeof value!=='string'||value.length>2048)throw Error('browser_url_invalid');
  let url;try{url=new URL(value);}catch{throw Error('browser_url_invalid');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('browser_url_invalid');
  return url.href;
}

// A page-opening bridge, not browser automation or an authenticated page reader.
export function installWorkspaceBrowser(service){
  if(typeof process.send!=='function')return;
  const pending=new Map();
  process.on('message',message=>{
    const capture=message?.workspaceCaptureReply;if(capture){const waiting=pending.get(capture.id);if(!waiting)return;clearTimeout(waiting.timer);pending.delete(capture.id);if(capture.error)waiting.reject(Error(/^[a-z_]+$/.test(capture.error)?capture.error:'browser_capture_unavailable'));else waiting.resolve({image:String(capture.image||''),width:capture.width,height:capture.height,url:capture.url,title:capture.title});return;}
    const reply=message?.workspacePageReply,item=pending.get(reply?.id);if(!item)return;
    clearTimeout(item.timer);pending.delete(reply.id);
    reply.error?item.reject(Error(/^[a-z_]+$/.test(reply.error)?reply.error:'browser_unavailable')):item.resolve({opened:reply.opened===true,...(typeof reply.tabId==='string'?{tabId:reply.tabId}:{}),userInteractionRequired:true});
  });
  process.on('disconnect',()=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('browser_unavailable'));}pending.clear();});
  service.openWorkspacePage=async({url,authentication=false})=>{
    const id=randomUUID(),target=workspacePageUrl(url);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('browser_unavailable'));},15000);
      pending.set(id,{resolve,reject,timer});
      process.send({workspacePageRequest:{id,url:target,authentication:authentication===true}},error=>{if(!error)return;const item=pending.get(id);if(item){clearTimeout(item.timer);pending.delete(id);reject(Error('browser_unavailable'));}});
    });
  };
  // One PNG of the active Workspace browser tab; the host bounds its size and the caller sends it to a vision model.
  service.captureWorkspacePage=async()=>{
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('browser_capture_unavailable'));},20000);
      pending.set(id,{resolve,reject,timer});
      process.send({workspaceCaptureRequest:{id}},error=>{if(!error)return;const item=pending.get(id);if(item){clearTimeout(item.timer);pending.delete(id);reject(Error('browser_unavailable'));}});
    });
  };
  // One PNG of Nubi's own window (2026-10-14), for questions about what the app itself shows.
  service.captureWorkspaceWindow=async()=>{
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('browser_capture_unavailable'));},20000);
      pending.set(id,{resolve,reject,timer});
      process.send({workspaceCaptureRequest:{id,target:'window'}},error=>{if(!error)return;const item=pending.get(id);if(item){clearTimeout(item.timer);pending.delete(id);reject(Error('browser_unavailable'));}});
    });
  };
  service.closeWorkspaceAuthPage=async tabId=>{
    if(typeof tabId!=='string')return;
    process.send({workspaceAuthPageClose:{tabId}});
  };
}
