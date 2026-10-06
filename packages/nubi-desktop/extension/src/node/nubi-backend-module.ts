import {ContainerModule} from '@theia/core/shared/inversify';
import {ConnectionHandler, RpcConnectionHandler} from '@theia/core/lib/common/messaging';
import {fork, ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import * as path from 'node:path';
import {NUBI_SERVICE_PATH, NubiService} from '../common/protocol';
import {KeyStoreService} from '@theia/core/lib/common/key-store';
// @ts-ignore shared host-neutral worker setup is bundled by Theia
import {configureSystemTrust} from '../../../runtime/worker-environment.mjs';
const {TheiaHost}=require('./theia-host.cjs');
configureSystemTrust();

class Host implements NubiService {
  private child: ChildProcess;
  private pending = new Map<string,{resolve:(result:unknown)=>void;reject:(error:Error)=>void}>();
  clients=0;
  root?:string;
  private native: any;
  get connected(){return this.child.connected;}
  constructor(keyStore: KeyStoreService) {
    this.child = fork(path.join(__dirname,'service-entry.mjs'),[],{stdio:['ignore','pipe','pipe','ipc']});
    this.child.stdout?.on('data',()=>{}); this.child.stderr?.on('data',data=>{if(process.env.NUBI_DEBUG) process.stderr.write(data);});
    this.child.on('message',(message:any)=>{const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);message.error?pending.reject(new Error(message.error)):pending.resolve(message.result);});
    this.child.on('exit',()=>{for(const item of this.pending.values())item.reject(new Error('host_disconnected'));this.pending.clear();});
    this.native=new TheiaHost({keyStore,invoke:(method:string,args:any={})=>this.invoke(method,args),helperPath:path.join(__dirname,'git-askpass.cjs')});
  }
  invoke(method:string,args:Record<string,unknown>={}) {
    if(method==='openTeamWorkspace')return this.native.openTeamWorkspace();
    if(method==='ghesAccount')return this.native.accountAction(args.operation);
    if(method==='ghesRepositories')return this.native.listRepositories();
    if(method==='connectMarketplace')return this.native.connectMarketplace();
    if(method==='cloneRepository')return this.native.clone(args);
    return new Promise((resolve,reject)=>{if(!this.child.connected)return reject(new Error('host_disconnected'));if(method==='open'&&this.root&&args.root!==this.root&&this.clients>1)return reject(new Error('project_busy'));const id=randomUUID();this.pending.set(id,{resolve:result=>{if(method==='open')this.root=String(args.root);resolve(result);},reject});this.child.send({id,method,args});});
  }
  dispose(){this.native.dispose();if(this.child.connected)this.child.disconnect();}
}
export default new ContainerModule(bind=>{
  bind(ConnectionHandler).toDynamicValue(ctx=>{
    let current:Host|undefined,timer:ReturnType<typeof setTimeout>|undefined;
    return new RpcConnectionHandler(NUBI_SERVICE_PATH,client=>{
      clearTimeout(timer);if(!current?.connected)current=new Host(ctx.container.get(KeyStoreService));const host=current;host.clients++;
      // Renderer reloads keep the same memory-only login and owned run. Never replay an RPC.
      client.onDidCloseConnection(()=>{host.clients--;if(!host.clients){timer=setTimeout(()=>{if(!host.clients){host.dispose();if(current===host)current=undefined;}},30000);timer.unref();}});
      return host;
    });
  }).inSingletonScope();
});
