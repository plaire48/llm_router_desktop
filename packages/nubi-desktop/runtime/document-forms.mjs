// Registered Word forms in the Workspace (document forms plan Task B, 2026-10-21): a form the person opened is read
// once (Task A), its map is kept under `.nubi/forms/<name>/` with the source hash and a preview, and a question plan
// asks for the required values the form still needs, grouped so one card covers one table or one section.
// Values never live here: the map holds slots and guides, the preview holds labels, nothing holds an answer.
import {mkdir,readFile,writeFile,readdir,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
import {extractFormMap} from './docx-snapshot.mjs';
import {mapSummary} from '../generated/office-forms.mjs';
import {scopedFile,hash,fail} from './files.mjs';

export const FORMS_DIR='.nubi/forms';
const NAME=/^[a-z0-9가-힣][a-z0-9가-힣 _-]{0,60}$/i;
export const safeFormName=name=>{if(typeof name!=='string'||!NAME.test(name)||name.trim()!==name)fail('form_name_invalid');return name;};
export const formNameFromFile=file=>{const base=path.basename(String(file||''),path.extname(String(file||''))).trim().replace(/[^a-z0-9가-힣 _-]+/gi,' ').replace(/\s+/g,' ').trim().slice(0,61);return NAME.test(base)?base:'양식';};
const EXAMPLES={date:'2026. 10. 21.',period:'2026. 10. 21. ~ 2026. 10. 25.',amount:'1,200,000',text:''};

async function formDir(workspace,name,{create=false}={}){
  safeFormName(name);const root=await realpath(workspace),rel=`${FORMS_DIR}/${name}`;
  if(create){await mkdir(path.join(root,FORMS_DIR),{recursive:true});await mkdir(path.join(root,rel),{recursive:true});}
  let dir;try{dir=await scopedFile(root,rel);if(!(await lstat(dir)).isDirectory())fail('form_missing');}catch(error){if(error.code==='ENOENT')fail('form_missing');throw error;}
  return {root,rel,dir};
}
/** A readable summary of a map for the registration card: no values, labels and kinds only. */
export function formPreview(map,{name,source,registeredAt}){
  return {name,source,registeredAt,summary:mapSummary(map),
    slots:map.slots.map(slot=>({id:slot.id,kind:slot.kind,label:slot.label,...(slot.valueType?{valueType:slot.valueType}:{}),required:slot.required!==false,...(slot.header?{header:slot.header,emptyRows:slot.emptyRows}:{}),...(slot.guides?{guides:slot.guides}:{})})),
    sections:map.sections.map(section=>({id:section.id,title:section.title,needsText:section.needsText,...(section.listString?{listString:section.listString}:{})})),
    notes:map.notes.map(note=>note.text),unsure:map.unsure.length};
}
/** Reads the source docx (inside the Workspace or anywhere the person chose) and keeps its map under .nubi/forms. */
export async function registerForm({workspace,source,name}){
  if(typeof source!=='string'||!source)fail('form_source_required');
  const formName=name?safeFormName(name):formNameFromFile(source);
  const bytes=await readFile(source).catch(error=>{if(error.code==='ENOENT')fail('form_source_missing');throw error;});
  const {map,hash:sourceHash,items}=await extractFormMap(bytes,{name:path.basename(source)});
  const {root,rel}=await formDir(workspace,formName,{create:true});
  const registeredAt=new Date().toISOString();
  const sourceRel=path.isAbsolute(source)&&(await realpath(source)).startsWith(root+path.sep)?path.relative(root,await realpath(source)):null;
  const preview=formPreview(map,{name:formName,source:sourceRel??path.basename(source),registeredAt});
  await writeFile(await scopedFile(root,`${rel}/form-map.json`,{newFile:true}),JSON.stringify({...map,registeredAt},null,1)+'\n');
  await writeFile(await scopedFile(root,`${rel}/source.sha256`,{newFile:true}),sourceHash+(sourceRel?' '+sourceRel:'')+'\n');
  await writeFile(await scopedFile(root,`${rel}/preview.json`,{newFile:true}),JSON.stringify(preview,null,1)+'\n');
  // The form's own items (labels and guide text, no values): the fill run's ledger needs them without the source file.
  await writeFile(await scopedFile(root,`${rel}/items.json`,{newFile:true}),JSON.stringify(items,null,0)+'\n');
  return {name:formName,map,hash:sourceHash,preview,changed:false};
}
/** The kept map; `changed` says whether the source file (when it is still in the Workspace) differs from the registered one. */
export async function loadForm(workspace,name,{source}={}){
  const {root,rel}=await formDir(workspace,name);
  let text;try{text=await readFile(await scopedFile(root,`${rel}/form-map.json`),'utf8');}catch(error){if(error.code==='ENOENT')fail('form_missing');throw error;}
  let map;try{map=JSON.parse(text);}catch{fail('form_map_invalid');}
  if(map?.kind!=='template_map'||!Array.isArray(map.slots))fail('form_map_invalid');
  const record=(await readFile(await scopedFile(root,`${rel}/source.sha256`),'utf8').catch(()=>'')).trim(),[registeredHash,...rest]=record.split(' '),sourceRel=rest.join(' ')||null;
  const preview=JSON.parse(await readFile(await scopedFile(root,`${rel}/preview.json`),'utf8').catch(()=>'null'));
  const items=JSON.parse(await readFile(await scopedFile(root,`${rel}/items.json`),'utf8').catch(()=>'null'));
  const candidate=source??(sourceRel?path.join(root,sourceRel):null);
  let changed=null;
  if(candidate){try{changed=hash(await readFile(candidate))!==registeredHash;}catch(error){if(error.code!=='ENOENT')throw error;changed=null;}}
  return {name,map,items:Array.isArray(items)?items:null,hash:registeredHash,source:sourceRel,preview,changed};
}
export async function listForms(workspace){
  const root=await realpath(workspace);let names=[];
  try{names=(await readdir(path.join(root,FORMS_DIR),{withFileTypes:true})).filter(e=>e.isDirectory()&&NAME.test(e.name)).map(e=>e.name);}catch(error){if(error.code!=='ENOENT')throw error;}
  const forms=[];for(const name of names.sort()){try{const {preview,hash:sourceHash}=await loadForm(workspace,name);forms.push({name,summary:preview?.summary??'',registeredAt:preview?.registeredAt??null,hash:sourceHash});}catch{/* A broken folder is not listed. */}}
  return forms;
}
const groupOf=slot=>slot.kind==='cell'?slot.target.split('/')[0]:slot.kind==='rows'?slot.target:slot.section??'body';
const present=value=>value!==undefined&&value!==null&&String(Array.isArray(value)?value.join(''):value).trim()!=='';
/** The questions a filled form still needs: required slots and sections without a value, one question per table or section. */
export function formQuestionPlan(map,values={}){
  const groups=new Map(),filled=[];
  const add=(group,field)=>{if(!groups.has(group))groups.set(group,{id:'q'+(groups.size+1),group,fields:[]});groups.get(group).fields.push(field);};
  for(const slot of map.slots){
    const value=values[slot.id];
    if(present(value)){filled.push({id:slot.id,label:slot.label});continue;}
    if(slot.kind==='rows'){add(groupOf(slot),{slot:slot.id,label:slot.label,kind:'rows',header:slot.header,emptyRows:slot.emptyRows,required:false});continue;}
    add(groupOf(slot),{slot:slot.id,label:slot.label,kind:slot.valueType??'text',required:slot.required!==false,...(slot.guides?.length?{example:slot.guides[0]}:EXAMPLES[slot.valueType]?{example:EXAMPLES[slot.valueType]}:{})});
  }
  for(const section of map.sections){
    if(!section.needsText)continue;
    const value=values[section.id];
    if(present(value)){filled.push({id:section.id,label:section.title});continue;}
    add(section.id,{slot:section.id,label:section.title,kind:'text',required:true,...(section.guide?{example:section.guide}:{}),...(section.listString?{listString:section.listString}:{})});
  }
  const questions=[...groups.values()].map(question=>({...question,required:question.fields.some(field=>field.required),label:question.fields.length===1?question.fields[0].label:question.fields.map(field=>field.label).join(', ').slice(0,120)}));
  // Required questions first, in form order; optional rows after them. Ids follow that final order.
  const ordered=[...questions.filter(q=>q.required),...questions.filter(q=>!q.required)].map((question,i)=>({...question,id:'q'+(i+1)}));
  return {questions:ordered,filled,summary:mapSummary(map)};
}
