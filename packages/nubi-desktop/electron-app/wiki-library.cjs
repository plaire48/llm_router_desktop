const fs=require('node:fs/promises');
const {constants}=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const hash=text=>createHash('sha256').update(text).digest('hex');
const {mailRelations}=require('../runtime/mail-relations.cjs');
const {describeWikiPage,threadEdges}=require('./wiki-frontmatter.cjs');
const fail=code=>{throw Error(code);};
const LIMIT=1024*1024;
function valid(name){return typeof name==='string'&&name.length<=500&&/\.md$/i.test(name)&&!/[\\:\x00-\x1f<>"|?*]/.test(name)&&name.split('/').every(p=>p&&!p.startsWith('.')&&!/[. ]$/.test(p)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));}
async function target(root,rel,{create=false}={}){
 if(!valid(rel))fail('wiki_library_scope');
 root=path.resolve(root);let cursor=root;
 if((await fs.lstat(root)).isSymbolicLink())fail('wiki_library_scope');
 for(const part of rel.split('/')){cursor=path.join(cursor,part);try{if((await fs.lstat(cursor)).isSymbolicLink())fail('wiki_library_scope');}catch(e){if(!(create&&e.code==='ENOENT'&&cursor===path.join(root,rel)))throw e;}}
 const realRoot=await fs.realpath(root),parent=await fs.realpath(path.dirname(cursor));
 if(parent!==realRoot&&!parent.startsWith(realRoot+path.sep))fail('wiki_library_scope');return cursor;
}
async function read(root,rel){
 const file=await target(root,rel),handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{const before=await handle.stat();if(!before.isFile()||before.size>LIMIT)fail('wiki_library_limit');
  const bytes=Buffer.alloc(LIMIT+1),{bytesRead}=await handle.read(bytes,0,bytes.length,0),after=await handle.stat();
  if(bytesRead>LIMIT)fail('wiki_library_limit');if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)fail('wiki_library_changed');
  let content;try{content=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead));}catch{fail('wiki_library_encoding');}
  if(content.includes('\0'))fail('wiki_library_encoding');return {path:rel,content,hash:hash(content),updatedAt:after.mtime.toISOString()};
 }finally{await handle.close();}
}
function documentLinks(content,from,paths){
 const text=content.replace(/^```[^]*?^```.*$/gm,'').replace(/`[^`\n]*`/g,'');const found=new Set();
 for(const match of text.matchAll(/(?<!!)\[[^\]\n]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)|\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)){
  let dest=match[1]||match[2]||match[3];try{dest=decodeURIComponent(dest.split('#')[0]);}catch{continue;}
  if(!dest||/^[a-z][a-z\d+.-]*:/i.test(dest)||dest.startsWith('//'))continue;
  const candidates=[path.posix.normalize(path.posix.join(path.posix.dirname(from),dest)),dest.replace(/^\/?openwiki\//,'')];
  if(match[3]){candidates.push(...candidates.map(p=>p+'.md'));const names=[...paths].filter(p=>path.posix.basename(p,'.md')===dest);if(names.length===1)candidates.push(names[0]);}
  const to=candidates.find(p=>paths.has(p));if(to&&to!==from)found.add(to);
 }
 return [...found];
}
class WikiLibrary{
 constructor({roots,backupRoot,canWrite=async()=>true}){this.roots=roots;this.backupRoot=backupRoot;this.canWrite=canWrite;this.writes=new Set();}
 async scope(id){const value=(await this.roots()).find(r=>r.id===id);if(!value)fail('wiki_library_scope');return value;}
 async call(args={}){
  if(args.action==='roots')return {items:(await this.roots()).map(({root,...r})=>r)};
  const scope=await this.scope(args.scopeId);
  if(args.action==='read')return read(scope.root,args.path);
  if(args.action==='list'){
   const items=[],skipped=[];let entries=0,bytes=0,truncated=false;
   async function walk(rel=''){
    let files;try{if((await fs.lstat(path.join(scope.root,rel))).isSymbolicLink())return;files=await fs.readdir(path.join(scope.root,rel),{withFileTypes:true});}catch(e){if(e.code==='ENOENT'&&!rel)return;throw e;}
    for(const f of files.sort((a,b)=>a.name.localeCompare(b.name))){if(++entries>50000||items.length>=3000||bytes>120*LIMIT){truncated=true;break;}
     if(f.name.startsWith('.')||['nubi-evidence','nubi-map','node_modules'].includes(f.name)||f.isSymbolicLink())continue;
     const name=rel?rel+'/'+f.name:f.name;if(f.isDirectory()){if(name.split('/').length<=15)await walk(name);else truncated=true;}
     else if(f.isFile()&&valid(name)){try{const doc=await read(scope.root,name);bytes+=Buffer.byteLength(doc.content);if(bytes>120*LIMIT){truncated=true;break;}const page=describeWikiPage(doc.content,name);items.push({...doc,title:page.title,type:page.type,category:page.category,cluster:page.cluster,clusterTitle:page.clusterTitle,topic:page.topic,description:page.description,tags:page.tags,thread:page.thread,messageId:page.messageId,inReplyTo:page.inReplyTo,references:page.references,from:page.from,to:page.to,cc:page.cc,date:page.date,size:doc.content.length});}catch{skipped.push(name);}}
    }
   }
   await walk();const paths=new Set(items.map(i=>i.path)),edges=items.flatMap(i=>documentLinks(i.content,i.path,paths).map(to=>({from:i.path,to})));
   const mailLinks=mailRelations(items.filter(i=>i.type?.toLowerCase()==='mail'));
   for(const edge of [...mailLinks.edges,...threadEdges(items.filter(i=>i.type?.toLowerCase()!=='mail'))])if(!edges.some(e=>e.from===edge.from&&e.to===edge.to))edges.push(edge);
   return {items:items.map(({content,...i})=>i),edges,skipped,truncated,relationsTruncated:mailLinks.truncated};
  }
  if(args.action!=='save')fail('wiki_library_action');
  if(scope.kind==='mail'&&(args.expectedHash===null||typeof args.content==='string'&&args.content.length>60000))fail('wiki_library_mail_limit');
  if(typeof args.content!=='string'||Buffer.byteLength(args.content)>LIMIT||args.content.includes('\0')||!valid(args.path))fail('wiki_library_limit');
  const key=scope.id+':'+args.path;if(this.writes.has(key))fail('wiki_library_busy');this.writes.add(key);
  let temporary;
  try{
   if(!(await this.canWrite(scope)))fail('wiki_library_busy');
   await fs.mkdir(scope.root,{recursive:true});const file=await target(scope.root,args.path,{create:true});let previous;
   try{previous=await read(scope.root,args.path);}catch(e){if(e.code!=='ENOENT')throw e;}
   if((previous?.hash||null)!==args.expectedHash)fail('wiki_library_changed');
   if(previous?.content===args.content)return previous;
   // Preserve the exact before-image outside the project and AI source tree.
   // Mail pages are encrypted at rest; a plain before-image outside the mail store would undo that (2026-10-14).
   if(previous&&scope.kind!=='mail'){await fs.mkdir(this.backupRoot,{recursive:true});await fs.writeFile(path.join(this.backupRoot,randomUUID()+'.json'),JSON.stringify({scopeId:scope.id,...previous}),{mode:0o600,flag:'wx'});}
   temporary=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temporary,args.content,{mode:0o600,flag:'wx'});
   if(!(await this.canWrite(scope)))fail('wiki_library_busy');
   if(previous){if((await read(scope.root,args.path)).hash!==previous.hash)fail('wiki_library_changed');await target(scope.root,args.path);await fs.rename(temporary,file);}
   else{await target(scope.root,args.path,{create:true});await fs.copyFile(temporary,file,constants.COPYFILE_EXCL).catch(e=>{if(e.code==='EEXIST')fail('wiki_library_changed');throw e;});}
   const saved=await read(scope.root,args.path);if(saved.hash!==hash(args.content))fail('wiki_library_unconfirmed');return saved;
  }finally{if(temporary)await fs.rm(temporary,{force:true}).catch(()=>{});this.writes.delete(key);}
 }
}
module.exports={WikiLibrary,documentLinks};
