import {Plugin,Modal,Setting,Notice,MarkdownView} from 'obsidian';
import {request} from 'node:http';
import {createObsidianEditorPort} from '../../src/editor-adapters';
// Node's loopback client avoids renderer CORS exceptions and never sends credentials to a web origin.
function rpc(port:number,token:string,path:string,data:unknown){return new Promise<any>((resolve,reject)=>{
 const bytes=JSON.stringify(data);const req=request({hostname:'127.0.0.1',port,path,method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(bytes)},timeout:15000},res=>{res.setEncoding('utf8');let body='';res.on('data',chunk=>{body+=chunk;if(body.length>2200000)req.destroy(Error('editor_response_limit'));});res.on('end',()=>{try{if(res.statusCode!==200)throw Error('editor_disconnected');resolve(JSON.parse(body));}catch(e){reject(e);}});});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('editor_timeout')));req.end(bytes);
});}
export default class NubiPlugin extends Plugin{
 stop:()=>void=()=>{};
 onload(){this.addCommand({id:'connect-current-document',name:'누비에 현재 문서 연결',editorCallback:(editor,context)=>{
  const view=context as MarkdownView,file=view.file;if(!file||typeof view.getMode!=='function'||view.getMode()!=='source'){new Notice('편집 모드에서 문서를 열어 주세요.');return;}
  const modal=new Modal(this.app);modal.titleEl.setText('누비 Workspace 연결');let code='',paired=false;let stopAttempt:(()=>void)|undefined;modal.onClose=()=>{if(!paired)stopAttempt?.();};
  new Setting(modal.contentEl).setName('연결 코드').addText(input=>input.onChange(v=>code=v.trim()));
  new Setting(modal.contentEl).addButton(button=>button.setButtonText('현재 문서 연결').setCta().onClick(async()=>{
   const match=/^nubi-editor:(\d{1,5}):([a-f0-9-]{72})$/.exec(code);if(!match||+match[1]>65535||+match[1]<1){new Notice('누비에서 복사한 연결 코드를 확인해 주세요.');return;}
   button.setDisabled(true);this.stop();let closed=false,timer:number,revision=1;const controller=new AbortController(),port=+match[1];let token='';
   const change=this.app.workspace.on('editor-change',(changed)=>{if(changed===editor)revision++;});
   const connected=()=>!closed&&view.file===file&&view.editor===editor&&view.getMode()==='source'&&this.app.workspace.getLeavesOfType('markdown').some(leaf=>leaf.view===view);
   const stop=()=>{if(closed)return;closed=true;controller.abort();window.clearTimeout(timer);this.app.workspace.offref(change);if(token)void rpc(port,token,'/disconnect',{}).catch(()=>{});};
   this.stop=stop;stopAttempt=stop;
   try{const result=await rpc(port,match[2],'/connect',{documentId:file.path,title:file.name});token=result.token;if(closed){void rpc(port,token,'/disconnect',{}).catch(()=>{});return;}if(!connected()){stop();return;}
    const adapter=createObsidianEditorPort({connectionId:result.binding.connectionId,documentId:file.path,editor,isConnected:connected,readOnly:()=>view.getMode()!=='source',revision:()=>revision,dirty:()=> 'unknown'});
    const poll=async()=>{if(!connected()){stop();return;}try{const {requests}=await rpc(port,token,'/poll',{});for(const item of requests){let value,error;try{value=item.operation==='inspect'?await adapter.inspect(controller.signal):item.operation==='replace'?await adapter.replaceIfCurrent(item.args.before,item.args.patch,controller.signal):null;}catch{error='editor_adapter_failed';}await rpc(port,token,'/reply',{id:item.id,value,error});}if(!closed)timer=window.setTimeout(poll,250);}catch{stop();new Notice('누비 문서 연결이 종료됐어요.');}};
    void poll();paired=true;modal.close();new Notice('누비에서 문서 이름을 확인하고 연결해 주세요.');
   }catch{stop();new Notice('누비 연결을 확인하지 못했어요.');button.setDisabled(false);}
  }));modal.open();
 }});this.addCommand({id:'disconnect-document',name:'누비 문서 연결 해제',callback:()=>this.stop()});}
 onunload(){this.stop();}
}
