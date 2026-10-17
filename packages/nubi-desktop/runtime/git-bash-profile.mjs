import path from 'node:path';
import {access} from 'node:fs/promises';
import {homedir} from 'node:os';

// Own the actual shell process, not Git's bin/bash.exe launch wrapper.
// Keep Git's environment local to this child; never change the host PATH.
export async function gitBashProfile({env=process.env,exists=access,executable:requested}={}){
 requested=requested?path.win32.normalize(requested):requested;
 const requestedRoot=requested&&/\\(?:usr\\)?bin\\bash\.exe$/i.test(requested)?requested.replace(/\\(?:usr\\)?bin\\bash\.exe$/i,''):null;
 const roots=requested?(requestedRoot?[requestedRoot]:[]):[path.win32.join(env.ProgramFiles||'C:\\Program Files','Git'),...(env.LOCALAPPDATA?[path.win32.join(env.LOCALAPPDATA,'Programs','Git')]:[])];
 for(const root of roots){
  const executable=path.win32.join(root,'usr','bin','bash.exe');
  try{await exists(executable);await exists(path.win32.join(root,'cmd','git.exe'));return {id:'bash',label:'Git Bash',executable,args:['--noprofile','--norc','-c'],gitBashRoot:root};}catch{}
 }
 return null;
}
export function applyGitBashEnvironment(env,root){
 if(!root)return;
 const keys=Object.keys(env).filter(k=>k.toLowerCase()==='path'),existing=keys.map(k=>env[k]).find(Boolean)||'';
 for(const key of keys)delete env[key];
 env.PATH=[path.win32.join(root,'cmd'),path.win32.join(root,'mingw64','bin'),path.win32.join(root,'usr','bin'),existing].filter(Boolean).join(';');
 env.MSYSTEM='MINGW64';
 if(!env.HOME)env.HOME=homedir();
 if(!env.PLINK_PROTOCOL)env.PLINK_PROTOCOL='ssh';
}
