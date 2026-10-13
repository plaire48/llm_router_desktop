import {disableHostedTracing,configureSystemTrust} from './worker-environment.mjs';
import {installWorkspaceBrowser} from './workspace-browser.mjs';
import {installConnectionVault} from './connection-vault.mjs';
disableHostedTracing(process.env);
configureSystemTrust();
const {ProjectService,resolveProjectFolder}=await import('./project-service.mjs');
const {ProjectServices}=await import('./project-services.mjs');
const {installAgent}=await import('./agent.mjs');
installAgent(ProjectService);
const service = new ProjectService({storageRoot:process.env.NUBI_STORAGE_ROOT});
installWorkspaceBrowser(service);
installConnectionVault(service);
const projects=new ProjectServices({service,createService:()=>new ProjectService({storageRoot:process.env.NUBI_STORAGE_ROOT}),resolveRoot:resolveProjectFolder});
process.on('message', async message => {
  if (!message || typeof message.id !== 'string' || typeof message.method !== 'string') return;
  try {process.send?.({id:message.id,result:await projects.invoke(message.method,message.args)});}
  catch(error) {process.send?.({id:message.id,error:/^[a-z_]{3,50}$/.test(error.message) ? error.message : 'operation_failed'});}
});
process.on('disconnect',()=>{projects.dispose();setTimeout(()=>process.exit(0),1800);});
