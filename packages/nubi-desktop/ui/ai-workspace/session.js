import { GHES_CONFIG } from './config.js';
import { githubDisplayIdentity } from './githubIdentity.js';
// Nubi keeps the SSO session in the main process; the vendored ai_workspace code only needs to know that a session
// exists and who the user is. The token placeholder never reaches the network (hostFetch strips Authorization).
let hostUser=null;
export function setHostSession(user){hostUser=user&&user.login?user:null;}
export function hasActiveGithubSession(){return Boolean(hostUser);}
export function getGithubSession(){return {host:GHES_CONFIG.host,owner:GHES_CONFIG.owner,repo:GHES_CONFIG.repo,token:hostUser?'nubi-host-session':null};}
export function clearGithubSession(){hostUser=null;}
export function readGithubUser(){if(!hostUser)return null;try{const user=githubDisplayIdentity(hostUser);return user?.login&&Number.isSafeInteger(user.id)?user:null;}catch{return null;}}
export async function verifyGithubSession(){return readGithubUser();}
