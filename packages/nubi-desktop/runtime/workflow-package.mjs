import {realpath,lstat,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {parse,stringify} from 'yaml';
import {relativeFile,readSource,scopedFile,hash,fail} from './files.mjs';
import {validateWorkflow} from './workflow-schema.mjs';

const base='.nubi/workflows';
const safeSlug=slug=>{if(typeof slug!=='string'||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug))fail('path_scope');return slug;};
const schemaError=()=>Object.assign(new Error('workflow_schema'),{errors:[{code:'workflow_schema',path:'',message:'워크플로우 파일 형식을 확인해 주세요.'}]});
async function directory(root,rel){
  // Reject linked ancestors as well as linked leaf files. Keep package identity local.
  let prefix='';for(const part of relativeFile(rel).split('/')){prefix=prefix?prefix+'/'+part:part;const file=await scopedFile(root,prefix);const stat=await lstat(file);if(stat.isSymbolicLink())fail('path_scope');if(!stat.isDirectory())throw schemaError();}
  return path.join(root,rel);
}
async function source(root,rel,{optional=false}={}){
  try{const target=await scopedFile(root,rel);if((await lstat(target)).isSymbolicLink())fail('path_scope');return await readSource(root,rel);}
  catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
}
export async function loadWorkflowPackage(projectRoot,slug){
  safeSlug(slug);const root=await realpath(projectRoot),rel=`${base}/${slug}`;await directory(root,rel);
  const yaml=await source(root,`${rel}/workflow.yaml`),readme=await source(root,`${rel}/README.md`,{optional:true});
  const fixtures={},contents=[['workflow.yaml',yaml.content],['README.md',readme?.content??null]];
  let entries=[];try{const dir=await directory(root,`${rel}/fixtures`);entries=await readdir(dir,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}
  if(entries.length>100)throw schemaError();
  let size=Buffer.byteLength(yaml.content)+Buffer.byteLength(readme?.content||'');
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
    if(entry.isSymbolicLink())fail('path_scope');if(!entry.name.endsWith('.json'))continue;
    const input=await source(root,`${rel}/fixtures/${entry.name}`);size+=Buffer.byteLength(input.content);if(size>4*1024*1024)throw schemaError();
    try{Object.defineProperty(fixtures,entry.name,{value:JSON.parse(input.content),enumerable:true});}catch{throw schemaError();}contents.push([`fixtures/${entry.name}`,input.content]);
  }
  const packageHash=hash(JSON.stringify(contents));let workflow;
  try{workflow=parse(yaml.content,{maxAliasCount:100});}catch{throw Object.assign(schemaError(),{hash:packageHash});}
  const checked=validateWorkflow(workflow);
  if(!checked.ok)throw Object.assign(new Error(checked.errors[0].code),{errors:checked.errors,hash:packageHash});
  return {slug,workflow:checked.workflow,readme:readme?.content||'',fixtures,hash:packageHash};
}
export async function listWorkflowPackages(projectRoot){
  const root=await realpath(projectRoot);let entries;
  try{entries=await readdir(await directory(root,base),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const result=[];
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
    if(!entry.isDirectory()&&!entry.isSymbolicLink())continue;
    try{const item=await loadWorkflowPackage(root,entry.name);result.push({slug:item.slug,name:item.workflow.name,version:item.workflow.version,hash:item.hash,valid:true,errors:[]});}
    catch(error){result.push({slug:entry.name,name:entry.name,version:null,hash:error.hash||null,valid:false,errors:error.errors||[{code:error.message==='path_scope'?'path_scope':'workflow_schema',path:'',message:'워크플로우 파일을 확인해 주세요.'}]});}
  }return result;
}

// Imports create a new draft package only. They never overwrite or execute it.
export async function saveImportedWorkflow(projectRoot,{workflow,warnings=[]},assertCurrent=()=>{}){
 const checked=validateWorkflow(workflow);if(!checked.ok)throw Object.assign(Error(checked.errors[0].code),{errors:checked.errors});
 const root=await realpath(projectRoot);assertCurrent();
 for(const rel of ['.nubi',base]){assertCurrent();try{await mkdir(path.join(root,rel));}catch(error){if(error.code!=='EEXIST')throw error;}await directory(root,rel);assertCurrent();}
 const name=String(workflow.name).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,64)||'imported-workflow';
 for(let index=1;index<=1000;index++){
  const slug=safeSlug(name+(index===1?'':'-'+index)),rel=base+'/'+slug;assertCurrent();
  try{await mkdir(path.join(root,rel));}catch(error){if(error.code==='EEXIST')continue;throw error;}
  await directory(root,rel);assertCurrent();await writeFile(path.join(root,rel,'workflow.yaml'),stringify(workflow),{flag:'wx'});assertCurrent();
  await writeFile(path.join(root,rel,'README.md'),'# 가져온 워크플로우 초안\n\n자동 실행하지 않았습니다. 단계와 완료 조건을 확인하고 합성 시험 후 감독 실행하세요.\n\n'+warnings.map(row=>'- '+row.code+': '+row.message).join('\n')+'\n',{flag:'wx'});assertCurrent();
  const saved=await loadWorkflowPackage(root,slug);assertCurrent();return {slug,workflow:saved.workflow,warnings};
 }
 throw Error('workflow_import_limit');
}
