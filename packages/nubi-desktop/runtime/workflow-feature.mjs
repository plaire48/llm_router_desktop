// Workflows and routines are off in this release (user decision 2026-10-22, design light-flow §5.1).
// The implementation and stored data stay for a later release; every entry point refuses here.
import {DESKTOP_FEATURES} from './beta-features.mjs';
import {installWorkflowService} from './workflow-service.mjs';

export function workflowsEnabled(features=DESKTOP_FEATURES){return features.workflows===true;}
export function requireWorkflows(features=DESKTOP_FEATURES){if(!workflowsEnabled(features))throw Error('workflow_feature_off');}

// The methods installWorkflowService puts on ProjectService, read from the installer itself so a new one cannot be missed.
class Probe{}
installWorkflowService(Probe);
export const WORKFLOW_SERVICE_METHODS=Object.freeze(Object.getOwnPropertyNames(Probe.prototype).filter(name=>name!=='constructor'));

// Reading a stored run changes nothing; past results stay visible while workflows are off (final review 2026-10-22).
export const WORKFLOW_READ_METHODS=Object.freeze(['workflowRun']);
export function guardWorkflowMethods(Service,features=DESKTOP_FEATURES){
 const guarded=WORKFLOW_SERVICE_METHODS.filter(name=>!WORKFLOW_READ_METHODS.includes(name));
 for(const name of guarded){
  const original=Service.prototype[name];
  Service.prototype[name]=async function(...args){requireWorkflows(features);return original.apply(this,args);};
 }
 return guarded;
}
