import {constants} from 'node:fs';
import {mkdir,open,rename,unlink,lstat,realpath} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {KnowledgeScope} from './knowledge.js';
import {sameKnowledgeScope,validateKnowledgeScope} from './knowledge.js';
import {parseScreenWiki,screenWikiPath} from './knowledge-wiki.js';
import type {WikiDocumentPort} from './knowledge-wiki.js';
import {fail} from './contracts.js';

/** Optional Node host adapter for an explicitly selected existing OpenWiki repository root. */
export function createFileWikiDocuments(options:{root:string;authorize(request:{scope:KnowledgeScope;path:string;operation:'read'|'write';signal:AbortSignal}):Promise<boolean>}):WikiDocumentPort {
  if(!options.root||resolve(options.root)!==options.root||typeof options.authorize!=='function')fail('wiki_repository_invalid');
  const root=options.root,hash=(content:string)=>createHash('sha256').update(content).digest('hex');
  const physical=async(path:string,create=false)=>{
    if(!/^openwiki\/systems\/[a-zA-Z0-9_.:%-]+\/screens\/[a-f0-9]{64}\.md$/.test(path)||path.split('/').some(x=>x==='..'||x==='.'))fail('wiki_path_invalid');
    const canonical=await realpath(root);let directory=canonical;
    for(const part of path.split('/').slice(0,-1)){
      directory=join(directory,part);if(create)await mkdir(directory,{recursive:false}).catch(error=>{if(error.code!=='EEXIST')throw error;});
      const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())fail('wiki_path_invalid');
      if(!(await realpath(directory)).startsWith(canonical+sep))fail('wiki_path_invalid');
    }
    return join(directory,path.split('/').at(-1)!);
  };
  const authorize=async(path:string,scope:KnowledgeScope,operation:'read'|'write',signal:AbortSignal)=>{signal.throwIfAborted();validateKnowledgeScope(scope);if(!await options.authorize({path,scope:structuredClone(scope),operation,signal}))fail('wiki_access_denied');signal.throwIfAborted();};
  const readFile=async(file:string)=>{
    let handle;try{handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await handle.stat();if(!stat.isFile()||stat.size>150_000)fail('screen_wiki_invalid');const content=await handle.readFile('utf8');return {content,version:hash(content)};}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}finally{await handle?.close();}
  };
  const validatePath=async(path:string,scope:KnowledgeScope,content:string)=>{
    const record=parseScreenWiki(content);if(!sameKnowledgeScope(scope,record.scope)||await screenWikiPath(scope,record.evidence.screenId,record.evidence.variantId)!==path)fail('screen_store_scope_mismatch');
  };
  return {
    async read(path,scope,signal){await authorize(path,scope,'read',signal);let file;try{file=await physical(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}const result=await readFile(file);if(result)await validatePath(path,scope,result.content);signal.throwIfAborted();return result;},
    async compareAndSet(path,scope,expected,content,signal){
      await authorize(path,scope,'write',signal);await validatePath(path,scope,content);const file=await physical(path,true);let lock,temp:string|undefined;
      try{
        try{lock=await open(file+'.lock',constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')return false;throw error;}
        const old=await readFile(file);if(old)await validatePath(path,scope,old.content);if((old?.version??null)!==expected)return false;
        await authorize(path,scope,'write',signal);temp=file+'.'+randomUUID()+'.tmp';const handle=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
        try{await handle.writeFile(content);await handle.sync();}finally{await handle.close();}
        signal.throwIfAborted();await physical(path);await rename(temp,file);temp=undefined;
        const directory=await open(dirname(file),'r');try{await directory.sync();}finally{await directory.close();}return true;
      }finally{if(temp)await unlink(temp).catch(()=>{});if(lock){await lock.close();await unlink(file+'.lock');}}
    },
  };
}
