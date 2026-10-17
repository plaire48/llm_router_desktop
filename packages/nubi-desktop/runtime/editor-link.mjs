import {createServer} from 'node:http';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {registerEditor,liveEditor,revokeEditor} from './live-editor-host.mjs';
const states=new WeakMap();
const match=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function editorLink(service,args){
 service.ready();if(args.projectId!==service.projectId)throw Error('editor_scope_changed');
 if(args.action==='pair'){
  disposeEditorLink(service);if(args.app!=='obsidian')throw Error('editor_app_unavailable');
  const pairId=randomUUID(),secret=randomUUID()+randomUUID(),store=service.store,projectId=service.projectId;
  const entry={pairId,secret,registration:null,accepted:false,used:false,service,store,projectId};states.set(service,entry);
  const server=createServer(async(req,res)=>{
   const answer=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
   try{
    if(req.method!=='POST'||req.headers.origin||req.headers.host!==`127.0.0.1:${server.address()?.port}`||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||service.disposed||service.store!==store)throw Error('editor_link_rejected');
    const auth=req.headers.authorization?.replace(/^Bearer /,'');
    if(req.url==='/connect'){if(entry.used||!match(auth,secret))throw Error('editor_link_rejected');}
    else if(!entry.registration||!match(auth,entry.registration.token)||!['/poll','/reply','/disconnect'].includes(req.url))throw Error('editor_link_rejected');
    const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>2200000)throw Error('editor_text_limit');chunks.push(chunk);}const data=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
    if(req.url==='/connect'){
     if(entry.used)throw Error('editor_link_rejected');entry.used=true;entry.registration=registerEditor(service,{app:'obsidian',mode:'external',documentId:data.documentId,title:data.title});
     answer(200,entry.registration);return;
    }
    if(req.url==='/poll'&&!entry.accepted){answer(200,{requests:[]});return;}
    if(req.url==='/disconnect'){revokeEditor(service,entry.registration.token);answer(200,{disconnected:true});disposeEditorLink(service);return;}
    const value=await liveEditor(service,{...data,projectId,token:entry.registration.token,action:req.url.slice(1)});answer(200,value);
    if(req.url==='/disconnect')disposeEditorLink(service);
   }catch{answer(403,{error:'editor_link_rejected'});}
  });entry.server=server;server.requestTimeout=10000;server.headersTimeout=5000;server.maxConnections=4;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});server.unref();
  entry.timer=setTimeout(()=>{if(!entry.accepted)disposeEditorLink(service);},300000);entry.timer.unref();
  return {pairId,code:`nubi-editor:${server.address().port}:${secret}`,expiresInSeconds:300};
 }
 const entry=states.get(service);if(!entry||entry.pairId!==args.pairId)throw Error('editor_pair_expired');
 if(args.action==='status')return {document:entry.registration?{title:entry.registration.title,app:'obsidian'}:null};
 if(args.action==='accept'){if(!entry.registration)throw Error('editor_pair_pending');entry.accepted=true;clearTimeout(entry.timer);return entry.registration;}
 if(args.action==='cancel'){disposeEditorLink(service);return {cancelled:true};}
 throw Error('editor_action_invalid');
}
export function disposeEditorLink(service){const e=states.get(service);if(!e)return;states.delete(service);clearTimeout(e.timer);e.server?.close();e.server?.closeAllConnections();if(e.registration&&service.store===e.store)revokeEditor(service,e.registration.token);}
