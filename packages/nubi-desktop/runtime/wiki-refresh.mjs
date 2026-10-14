import {git,gitOpenFailure} from './files.mjs';

// "오픈위키 갱신" from the conversation or /wiki_update (user request 2026-10-14): a folder that came from git is pulled
// first, fast-forward only and never with a prompt, then the Wiki update runs as the 위키 갱신 button runs it. A folder
// without a remote, or one git cannot open, skips the pull and still updates the Wiki from the files as they are.
export async function pullSources(root){
  let remotes='';
  try{remotes=(await git(root,['remote'])).trim();}
  catch(error){return {attempted:false,reason:gitOpenFailure(error)};}
  if(!remotes)return {attempted:false,reason:'no_remote'};
  try{
    const output=await git(root,['pull','--ff-only'],{timeout:180000,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
    return {attempted:true,ok:true,output:String(output).trim().slice(-2000)};
  }catch(error){
    const detail=String(error?.stderr||error?.message||'').trim().slice(-2000);
    return {attempted:true,ok:false,reason:error?.killed?'git_timeout':/not possible to fast-forward|diverg/i.test(detail)?'git_diverged':/could not read|authentication|permission denied|terminal prompts disabled/i.test(detail)?'git_auth':'git_pull_failed',output:detail};
  }
}
