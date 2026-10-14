import {SKILL_NAME} from './skillPackage.js';
import {roleCapabilities} from '../adminClient.js';
import {GHES_CONFIG} from '../config.js';
import {SKILL_TAG_LIMIT} from './skillTags.js';
export const CATALOG_PATH='data/skills/catalog.json';
export const SKILL_MANAGER_LIMIT=11;
export const validHash=value=>/^[a-f\d]{64}$/.test(value||'');
export const packagePath=(name,hash)=>`data/skills/packages/${name}/${hash}.json`;
const fail=(message,field)=>{throw Object.assign(new Error(message),field?{field}:{});};
const versionPattern=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*))*))?$/;
const loginPattern=/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
export const validVersion=value=>typeof value==='string'&&value.length<=48&&versionPattern.test(value);
export function skillGithubUrl(value='') {
  const invalid=()=>fail('GitHub 또는 사내 GitHub의 https:// 주소를 입력하세요.','githubUrl');
  if(typeof value!=='string'||value.length>2048)invalid();
  const text=value.trim();
  if(!text)return '';
  if(/[\s\\\u0000-\u001f\u007f]/.test(text))invalid();
  let url;try{url=new URL(text);}catch{invalid();}
  const hosts=['github.com','www.github.com',GHES_CONFIG.host.toLowerCase()];
  if(url.protocol!=='https:'||url.username||url.password||!hosts.includes(url.host.toLowerCase()))invalid();
  return url.href;
}
export function compareVersions(a,b) {
  if(!validVersion(a)||!validVersion(b))fail('버전은 1.0.0 형식으로 입력하세요.');
  const aa=a.match(versionPattern),bb=b.match(versionPattern);
  for(let i=1;i<=3;i++){const x=BigInt(aa[i]),y=BigInt(bb[i]);if(x!==y)return x>y?1:-1;}
  if(!aa[4]||!bb[4])return aa[4]===bb[4]?0:aa[4]?-1:1;
  const x=aa[4].split('.'),y=bb[4].split('.');
  for(let i=0;i<Math.max(x.length,y.length);i++){
    if(x[i]===y[i])continue;if(x[i]===undefined)return -1;if(y[i]===undefined)return 1;
    const xn=/^\d+$/.test(x[i]),yn=/^\d+$/.test(y[i]);
    return xn&&yn?(BigInt(x[i])>BigInt(y[i])?1:-1):xn!==yn?(xn?-1:1):x[i]>y[i]?1:-1;
  }return 0;
}
export function skillManagers(value=[],{ownerLogin='',limit=SKILL_MANAGER_LIMIT}={}) {
  const names=(Array.isArray(value)?value:String(value).split(',')).map(v=>String(v).trim().toLowerCase()).filter(Boolean);
  if(names.some(v=>!loginPattern.test(v))||new Set(names).size!==names.length)fail('수정 권한은 중복 없이 올바른 GitHub ID로 지정하세요.','maintainers');
  const managers=names.filter(login=>login!==ownerLogin.toLowerCase());
  if(managers.length+1>limit)fail(`수정 권한은 최대 ${limit-1}명까지 지정할 수 있습니다.`,'maintainers');
  return managers;
}
// Display responsibility follows the latest successful save; grants remain explicit.
export const skillManagerLogin=item=>item.updatedBy||item.createdBy||'';
export const skillManagerLogins=item=>[...new Set([item.createdBy,...(item.maintainers||[])].filter(Boolean).map(login=>login.toLowerCase()))];
export const ownsSkill=(item,user,role)=>Boolean(user?.login)&&['user','editor','system'].includes(role)&&(roleCapabilities(role).edit||Boolean(item?.createdBy)&&item.createdBy.toLowerCase()===user.login.toLowerCase());
export const canManageSkill=(item,user,role)=>Boolean(user?.login)&&['user','editor','system'].includes(role)&&(ownsSkill(item,user,role)||(item?.maintainers||[]).some(v=>v.toLowerCase()===user.login.toLowerCase()));
export function skillReleases(item) {
  return item.releases||[{version:item.version,hash:item.hash,packagePath:item.packagePath,size:item.size,fileCount:item.fileCount,releasedAt:item.updatedAt,releasedBy:item.updatedBy,notes:'기존 등록 버전'}];
}
export const releaseItem=(item,release)=>({...item,...release,updatedAt:release.releasedAt,updatedBy:release.releasedBy,releases:undefined});
export function validateCatalog(document) {
  if(document?.schemaVersion!==1||!Array.isArray(document.skills)||document.skills.length>2000)fail('스킬 목록 형식을 확인하세요.');
  const names=new Set();
  for(const item of document.skills){
    if(!item||typeof item.name!=='string'||!SKILL_NAME.test(item.name)||item.name.length>64||names.has(item.name)||!validHash(item.hash)||item.packagePath!==packagePath(item.name,item.hash)||!Number.isSafeInteger(item.size)||item.size<=0||item.size>5*1024*1024||!Number.isSafeInteger(item.fileCount)||item.fileCount<1||item.fileCount>200||!Number.isFinite(Date.parse(item.updatedAt))||typeof item.updatedBy!=='string')fail('스킬 목록의 파일 정보가 올바르지 않습니다.');
    // Keep older catalogs readable; new uploads and edits use the current tag limit.
    validateSkillFields(item,{tagLimit:8});names.add(item.name);
    for(const key of ['codexPlugin','claudePlugin'])if(item[key]!==undefined&&(!validVersion(item[key]?.version)||!validHash(item[key]?.hash)))fail('플러그인 배포 버전을 확인하세요.');
    if(item.createdBy!==undefined&&!loginPattern.test(item.createdBy))fail('스킬 관리 정보를 확인하세요.');
    // Older catalogs may have ten co-maintainers; keep them readable without dropping access.
    if(item.maintainers!==undefined){if(!Array.isArray(item.maintainers))fail('관리자 정보를 확인하세요.');skillManagers(item.maintainers,{limit:11});}
    if(item.releases!==undefined){
      if(!Array.isArray(item.releases)||!item.releases.length||item.releases.length>500)fail('버전 기록은 1~500개까지 보관합니다.');
      const versions=new Set();let last=null;
      for(const release of item.releases){
        if(!release||!validVersion(release.version)||versions.has(release.version)||!validHash(release.hash)||release.packagePath!==packagePath(item.name,release.hash)||!Number.isSafeInteger(release.size)||release.size<1||release.size>5*1024*1024||!Number.isSafeInteger(release.fileCount)||release.fileCount<1||release.fileCount>200||!Number.isFinite(Date.parse(release.releasedAt))||!loginPattern.test(release.releasedBy)||typeof release.notes!=='string'||release.notes.length>2000||last&&compareVersions(release.version,last)<=0)fail('버전 기록의 파일 정보를 확인하세요.');
        versions.add(release.version);last=release.version;
      }
      const current=item.releases.at(-1);
      if(['version','hash','packagePath','size','fileCount'].some(key=>current[key]!==item[key]))fail('현재 버전과 최신 릴리스가 일치하지 않습니다.');
    }
  }
  return document;
}
export function validateSkillFields({title,description,version,tags,githubUrl},{tagLimit=SKILL_TAG_LIMIT}={}) {
  if(typeof title!=='string'||!title.trim()||title.length>100)fail('표시 이름을 1~100자로 입력하세요.','title');
  if(typeof description!=='string'||!description.trim()||description.length>1024)fail('설명을 1~1,024자로 입력하세요.','description');
  if(!validVersion(version))fail('버전은 1.0.0 형식으로 입력하세요.','version');
  if(!Array.isArray(tags)||tags.length>tagLimit||tags.some(tag=>typeof tag!=='string'||!tag.trim()||tag.length>24)||new Set(tags).size!==tags.length)fail(`태그는 중복 없이 최대 ${tagLimit}개, 각 24자까지 입력하세요.`,'tags');
  skillGithubUrl(githubUrl);
}
export function skillFields(form) {
  const value={title:form.title.trim(),description:form.description.trim(),version:form.version.trim(),tags:[...new Set(form.tags.map(s=>s.trim()).filter(Boolean))],githubUrl:skillGithubUrl(form.githubUrl)};
  validateSkillFields(value);return value;
}
export function filterSkills(skills,{query='',tag='',sort='updated'}={}) {
  const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return skills.filter(item=>(!tag||item.tags.includes(tag))&&terms.every(term=>`${item.title} ${item.name} ${item.description} ${item.tags.join(' ')} ${item.updatedBy}`.toLocaleLowerCase().includes(term)))
    .sort((a,b)=>sort==='name'?a.title.localeCompare(b.title,'ko'):b.updatedAt.localeCompare(a.updatedAt)||a.name.localeCompare(b.name));
}
