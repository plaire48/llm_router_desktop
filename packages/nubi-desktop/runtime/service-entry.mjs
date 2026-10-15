import {disableHostedTracing,configureSystemTrust} from './worker-environment.mjs';
import {installWorkspaceBrowser} from './workspace-browser.mjs';
import {installWikiGitBridge} from './wiki-git-bridge.mjs';
import {installConnectionVault} from './connection-vault.mjs';
disableHostedTracing(process.env);
configureSystemTrust();
const {ProjectService,resolveProjectFolder}=await import('./project-service.mjs');
const {ProjectServices}=await import('./project-services.mjs');
const {installAgent}=await import('./agent.mjs');
installAgent(ProjectService);
// Conversation memory runs in the product only; evaluations and tests measure runs without it.
const service = new ProjectService({storageRoot:process.env.NUBI_STORAGE_ROOT});service.memoryExtraction=true;service.mailFacts=true;service.progressNarration=true;
service.notifyAnswer=value=>{if(process.connected)process.send?.({answerCompleted:value},()=>{});};
installWorkspaceBrowser(service);
installWikiGitBridge(service);
installConnectionVault(service);
// Warm the MCP catalog off the first chat's critical path. No browser is launched.
const mcp=service.mcpRegistry();mcp.warming=mcp.connectEnabled().catch(()=>{});
const projects=new ProjectServices({service,createService:()=>Object.assign(new ProjectService({storageRoot:process.env.NUBI_STORAGE_ROOT}),{memoryExtraction:true,mailFacts:true}),resolveRoot:resolveProjectFolder});
process.on('message', async message => {
  if (!message || typeof message.id !== 'string' || typeof message.method !== 'string') return;
  try {process.send?.({id:message.id,result:await projects.invoke(message.method,message.args)});}
  catch(error) {process.send?.({id:message.id,error:/^[a-z_]{3,50}$/.test(error.message) ? error.message : 'operation_failed'});}
});
process.on('disconnect',()=>{projects.dispose();setTimeout(()=>process.exit(0),1800);});
