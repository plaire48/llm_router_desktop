import {ownsSkill,skillManagers,skillManagerLogin} from '../skills/skillModel.js';
import {validateWorkspaceIcon} from './workspaceIcon.js';
import {validateSiteDescriptor} from './workspaceSite.js';

export const WORKSPACE_PATH='data/workspace/catalog.json';
export const workspaceManagerLogins=item=>[skillManagerLogin(item)];
export const canCreateWorkspace=(user,role)=>Boolean(user?.login)&&['user','editor','system'].includes(role);
export const canMaintainWorkspace=user=>!user?.permissionIssue&&canCreateWorkspace(user,user?.role);
export const canOwnWorkspace=(item,user,role)=>canCreateWorkspace(user,role)&&ownsSkill(item,user,role);
export const canEditWorkspace=(item,user,role)=>canCreateWorkspace(user,role)&&(canOwnWorkspace(item,user,role)||(item?.editors||[]).some(login=>login.toLowerCase()===user.login.toLowerCase()));
export const workspaceEditors=(value=[],ownerLogin='')=>{try{return skillManagers(value,{ownerLogin});}catch(error){error.field='editors';throw error;}};
export const validWorkspaceId=value=>typeof value==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const loginPattern=/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const fail=(message,field)=>{throw Object.assign(new Error(message),{field});};

export function workspaceUrl(value) {
  const invalid=()=>fail('http:// 또는 https://로 시작하는 URL을 입력하세요.','url');
  if(typeof value!=='string'||value.length>2048)invalid();
  const text=value.trim();
  if(!/^https?:\/\//i.test(text)||/[\s\\\u0000-\u001f\u007f]/.test(text))invalid();
  let url;try{url=new URL(text);}catch{invalid();}
  if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password)invalid();
  if(url.href.length>2048)invalid();
  return url.href;
}

export function workspaceFields(value={}) {
  if(typeof value.title!=='string'||!value.title.trim()||value.title.length>100)fail('제목을 1~100자로 입력하세요.','title');
  if(typeof value.description!=='string'||!value.description.trim()||value.description.length>1000)fail('내용을 1~1,000자로 입력하세요.','description');
  if(value.kind!==undefined&&!['link','site'].includes(value.kind))fail('앱 종류를 확인하세요.');
  return {title:value.title.trim(),description:value.description.trim(),...(value.kind==='site'?{kind:'site'}:{url:workspaceUrl(value.url)})};
}

export function validateWorkspaceCatalog(document) {
  if(document?.schemaVersion!==1||!Array.isArray(document.items)||document.items.length>2000)fail('앱 목록 형식을 확인하세요.');
  const ids=new Set();
  for(const item of document.items){
    if(!item||!validWorkspaceId(item.id)||ids.has(item.id))fail('앱 식별자를 확인하세요.');
    workspaceFields(item);
    if(item.kind==='site')validateSiteDescriptor(item.site);
    if(item.icon!==undefined)validateWorkspaceIcon(item.icon);
    if(!['createdBy','updatedBy'].every(key=>typeof item[key]==='string'&&loginPattern.test(item[key]))||!['createdAt','updatedAt'].every(key=>typeof item[key]==='string'&&Number.isFinite(Date.parse(item[key]))))fail('앱 등록 정보를 확인하세요.');
    if(!Array.isArray(item.maintainers))fail('관리자 정보를 확인하세요.','maintainers');
    if(item.maintainers.some(login=>typeof login!=='string'||!loginPattern.test(login)))fail('이전 등록 정보를 확인하세요.');ids.add(item.id);
    if(item.editors!==undefined){if(!Array.isArray(item.editors)||item.editors.some(login=>typeof login!=='string'))fail('수정 권한을 확인하세요.','editors');workspaceEditors(item.editors,item.createdBy);}
  }
  return document;
}

export function filterWorkspaces(items,query='') {
  const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item=>terms.every(term=>`${item.title} ${item.description} ${item.url||''} ${item.site?.entry||''} ${workspaceManagerLogins(item).join(' ')}`.toLocaleLowerCase().includes(term)))
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.title.localeCompare(b.title,'ko')||a.id.localeCompare(b.id));
}
