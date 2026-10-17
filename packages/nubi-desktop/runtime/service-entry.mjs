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
service.notifyWiki=value=>{if(process.connected)process.send?.({wikiCompleted:value},()=>{});};
installWorkspaceBrowser(service);
installWikiGitBridge(service);
installConnectionVault(service);
// Warm the MCP catalog off the first chat's critical path. No browser is launched.
const mcp=service.mcpRegistry();mcp.warming=mcp.connectEnabled().catch(()=>{});
const projects=new ProjectServices({service,createService:()=>Object.assign(new ProjectService({storageRoot:process.env.NUBI_STORAGE_ROOT}),{memoryExtraction:true,mailFacts:true}),resolveRoot:resolveProjectFolder});
const {ExternalOffice}=await import('./external-office.mjs');
const externalOffice=new ExternalOffice();
process.on('message', async message => {
  if (!message || typeof message.id !== 'string' || typeof message.method !== 'string') return;
  try {if(projects.updateLocked)throw Error('update_installing');const result=await (message.method==='_externalOffice'?externalOffice.request(projects.current,message.args):projects.invoke(message.method,message.args));if(['open','deleteTask'].includes(message.method))externalOffice.pruneSelections(projects.current);process.send?.({id:message.id,result});}
  catch(error) {process.send?.({id:message.id,error:/^[a-z_]{3,50}$/.test(error.message) ? error.message : 'operation_failed'});}
});
process.on('disconnect',()=>{externalOffice.dispose();projects.dispose();setTimeout(()=>process.exit(0),1800);});
