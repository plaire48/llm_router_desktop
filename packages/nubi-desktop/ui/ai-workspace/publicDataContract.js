export const catalogNames = [
  'applied-status', 'customization-need', 'decision-results', 'decision-rules',
  'deployment-types', 'diagnosis-review-status', 'effort-category',
  'enhancement-target', 'enhancement-type', 'frequency-conversion',
  'human-intervention-level', 'non-automation-cause', 'non-target-reason',
  'organizations', 'priority', 'process-organizations', 'responsible-groups',
  'saving-time-conversion', 'standard-processes', 'verification-rating', 'inquiry-types',
];
export const PUBLIC_MANIFEST_PATH = 'data/published/manifest.json';
export const PUBLIC_WORK_PATH = 'data/masters/work-items.json';
export const PUBLIC_DATA_PATHS = Object.freeze([PUBLIC_WORK_PATH,...catalogNames.map(name=>`data/masters/${name}.json`),'data/configuration/automation-settings.json']);
export const validGitSha = value => typeof value === 'string' && /^[a-f\d]{40}$/i.test(value);
const bytes = value => typeof value === 'string' ? new TextEncoder().encode(value) : value;
export async function digest(value,algorithm='SHA-256') {
  return [...new Uint8Array(await crypto.subtle.digest(algorithm,bytes(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function gitBlobSha(value) {
  const body=bytes(value),header=bytes(`blob ${body.length}\0`),input=new Uint8Array(header.length+body.length);
  input.set(header);input.set(body,header.length);return digest(input,'SHA-1');
}
export function validateManifest(value) {
  if(value?.schemaVersion!==2||!validGitSha(value.sourceCommit)||!Number.isFinite(Date.parse(value.publishedAt))||!value.files||!value.changes||!value.rows)throw Error('게시 버전을 확인하지 못했습니다.');
  if(Object.keys(value.files).length!==PUBLIC_DATA_PATHS.length||PUBLIC_DATA_PATHS.some(path=>!validGitSha(value.files[path])))throw Error('게시 파일 목록을 확인하지 못했습니다.');
  for(const path of PUBLIC_DATA_PATHS){const change=value.changes[path];if(!change||change.sha!==null&&!validGitSha(change.sha)||change.date!==null&&!Number.isFinite(Date.parse(change.date)))throw Error('게시 변경 이력을 확인하지 못했습니다.');}
  for(const entry of Object.values(value.rows)){if(!entry||!/^[a-f\d]{64}$/.test(entry.digest)||entry.sha!==null&&!validGitSha(entry.sha))throw Error('행 변경 이력을 확인하지 못했습니다.');}
  return value;
}
const canonical = value => Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
// The manifest contains hashes and revision IDs, never a second copy of the data.
export async function createDataManifest({files,sourceCommit,publishedAt,rows,previous=null}) {
  if(previous)validateManifest(previous);
  const changes=Object.fromEntries(PUBLIC_DATA_PATHS.map(path=>[path,previous?.files[path]===files[path]?previous.changes[path]:{sha:sourceCommit,date:publishedAt}]));
  const rowEntries=[];
  for(const row of rows){
    const id=String(row.id),hash=await digest(JSON.stringify(canonical(row))),prior=previous?.rows[id];
    if(rowEntries.some(([key])=>key===id))throw Error('Agent ID가 중복됩니다.');
    // Initial imports do not falsely label historic rows with the migration commit.
    rowEntries.push([id,{digest:hash,sha:prior?.digest===hash?prior.sha:previous?sourceCommit:null}]);
  }
  return validateManifest({schemaVersion:2,sourceCommit,publishedAt,files,changes,rows:Object.fromEntries(rowEntries)});
}
