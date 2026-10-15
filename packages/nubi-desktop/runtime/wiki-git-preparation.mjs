import {git} from './files.mjs';

// Indexing many sources on Windows can exceed the ordinary interactive Git
// budget. Keep this bounded and cancellable without changing other Git calls.
export const WIKI_GIT_PREPARATION_TIMEOUT=10*60*1000;
export async function wikiPreparationGit(root,args,{signal,onGitStep,gitRun=git,env}={},step='index'){
 signal?.throwIfAborted();onGitStep?.(step);
 const value=await gitRun(root,args,{timeout:WIKI_GIT_PREPARATION_TIMEOUT,signal,...(env?{env}:{})});
 signal?.throwIfAborted();return value;
}
