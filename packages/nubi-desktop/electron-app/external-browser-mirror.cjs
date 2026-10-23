const {randomUUID}=require('node:crypto');

// This channel is exclusively for the person's visible content pane. Frames and
// clipboard values never enter worker RPC, model context, captures or history.
class ExternalBrowserMirror{
 constructor(host,{onEvent=()=>{}}={}){this.host=host;this.onEvent=onEvent;this.current=null;this.queue=Promise.resolve();}
 serial(work){const result=this.queue.then(work);this.queue=result.catch(()=>{});return result;}
 row(tabId){const row=this.host.tab(tabId),url=new URL(row.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('browser_url_invalid');return row;}
 binding(args){
  const stream=this.current;
  if(!stream||args.streamId!==stream.streamId||args.tabId!==stream.tabId||args.documentId!==stream.documentId)throw Error('browser_mirror_changed');
  const row=this.row(stream.tabId);
  if(row.automationDocument!==stream.documentId||this.host.generation!==stream.generation)throw Error('browser_mirror_changed');
  return stream;
 }
 async start(args={}){return this.serial(async()=>{
  const row=this.row(args.tabId);
  if(args.documentId!==row.automationDocument)throw Error('browser_document_changed');
  if(args.streamId!==undefined&&!/^[a-f0-9-]{36}$/.test(args.streamId))throw Error('browser_mirror_invalid');
  await this.stop();
  const stream={streamId:args.streamId||randomUUID(),tabId:row.id,documentId:row.automationDocument,generation:this.host.generation,sequence:0};this.current=stream;
  try{await this.host.command('mirrorStart',{streamId:stream.streamId,tabId:stream.tabId,documentId:stream.documentId,...(args.width!==undefined?{width:args.width,height:args.height}:{})});this.binding(stream);return {started:true,streamId:stream.streamId};}
  catch(error){if(this.current===stream)this.invalidate();throw error;}
 });}
 async stop(args={}){
  const stream=this.current;if(!stream||args.streamId&&args.streamId!==stream.streamId)return {stopped:false};
  this.invalidate();
  if(this.host.generation===stream.generation)await this.host.command('mirrorStop',{streamId:stream.streamId}).catch(()=>{});
  return {stopped:true};
 }
 invalidate(){const stream=this.current;this.current=null;if(stream)this.onEvent({type:'stopped',streamId:stream.streamId,tabId:stream.tabId});}
 update(){if(this.current){try{this.binding(this.current);}catch{void this.stop();}}}
 frame(packet){
  let stream;try{stream=this.binding(packet);}catch{return;}
  if(!Number.isSafeInteger(packet.sequence)||packet.sequence<=stream.sequence||typeof packet.data!=='string'||packet.data.length>1500000||! /^[A-Za-z0-9+/]*={0,2}$/.test(packet.data))return;
  if(!packet.viewport||![packet.viewport.width,packet.viewport.height].every(x=>Number.isFinite(x)&&x>0&&x<=32768))return;
  stream.sequence=packet.sequence;stream.viewport=packet.viewport;
  this.onEvent({type:'frame',streamId:stream.streamId,tabId:stream.tabId,documentId:stream.documentId,sequence:packet.sequence,data:packet.data,viewport:packet.viewport});
 }
 async ack(args){const stream=this.binding(args);if(args.sequence!==stream.sequence)return {acknowledged:false};return this.host.command('mirrorAck',{streamId:stream.streamId,tabId:stream.tabId,documentId:stream.documentId,sequence:args.sequence});}
 input(args){return this.serial(async()=>{
  const stream=this.binding(args);if(!stream.viewport)throw Error('browser_mirror_wait');
  const input=args.input;
  if(!input||typeof input!=='object'||JSON.stringify(input).length>120000)throw Error('browser_mirror_invalid');
  if(['mouse','wheel','context'].includes(input.kind)&&(!Number.isFinite(input.x)||!Number.isFinite(input.y)||input.x<0||input.y<0||input.x>stream.viewport.width||input.y>stream.viewport.height))throw Error('browser_mirror_bounds');
  return this.host.command('mirrorInput',{streamId:stream.streamId,tabId:stream.tabId,documentId:stream.documentId,input});
 });}
}
module.exports={ExternalBrowserMirror};
