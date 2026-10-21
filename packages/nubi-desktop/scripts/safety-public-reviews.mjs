import {createHash} from 'node:crypto';
const categories=new Set(['public_package_attribution','public_organization_contact','public_example','public_protocol_identifier','encoded_data']);
export const normalizePayloadPath=p=>p.replaceAll('\\','/').replace(/^Contents\/Resources\//,'resources/');
// The packaged Windows executable is electron.exe with resource and fuse edits, and with the embedded ASAR integrity hash
// its bytes change on every build, so an exact file hash can never be reviewed ahead of time. Its reviews bind instead to
// the pinned upstream electron.exe: each finding must appear with the same kind, fingerprint and count in those exact
// upstream bytes, and any other finding still blocks.
export const BOUND_EXECUTABLE='packaged_electron_executable';
const boundItem=(item,file)=>item.binding===BOUND_EXECUTABLE&&/^[^/]+\.exe$/.test(file)&&/^[0-9a-f]{64}$/.test(item.upstreamSha256||'')&&item.sha256===undefined&&/^[\w.-]+\.exe$/.test(item.source?.artifactPath||'');
export function createPublicReviewIndex(manifest={version:1,findings:[]},{upstream,scan}={}){
 const issues=[],byPath=new Map(),keys=new Set(),seen=new Set(),used=new Set(),upstreamCache=new Map();
 const tuple=f=>f.kind+'|'+f.fingerprint+'|'+f.occurrences;
 // Upstream bytes are trusted only when they hash to the reviewed upstreamSha256.
 const verifiedUpstream=item=>{
  if(!upstreamCache.has(item.upstreamSha256)){
   let found=null;try{const bytes=upstream?.(item);if(bytes&&scan&&createHash('sha256').update(bytes).digest('hex')===item.upstreamSha256)found=new Set(scan(item.source.artifactPath,bytes).map(tuple));}catch{}
   upstreamCache.set(item.upstreamSha256,found);
  }
  return upstreamCache.get(item.upstreamSha256);
 };
 if(manifest.version!==1||!Array.isArray(manifest.findings))issues.push({code:'safety_public_review_invalid',path:'review-manifest'});
 for(const item of manifest.findings||[]){
  const file=typeof item.path==='string'?normalizePayloadPath(item.path):'',key=file+'|'+item.kind+'|'+item.fingerprint;
  let url;try{url=new URL(item.source?.url);}catch{}
  if(!file||file.startsWith('/')||file.split('/').includes('..')||!['email','phone'].includes(item.kind)||!(/^\w{64}$/.test(item.sha256||'')&&item.binding===undefined||boundItem(item,file))||!/^\w{16}$/.test(item.fingerprint||'')||!Number.isInteger(item.occurrences)||item.occurrences<1||!categories.has(item.classification)||!url||url.protocol!=='https:'||url.username||url.password||!item.source?.integrity||!item.source?.artifactPath||typeof item.evidence!=='string'||item.evidence.length<20||!item.reviewer||!/^\d{4}-\d{2}-\d{2}$/.test(item.reviewedAt||'')||keys.has(key)){
   issues.push({code:'safety_public_review_invalid',path:file||'review-manifest'});continue;
  }
  keys.add(key);const list=byPath.get(file)||[];list.push(item);byPath.set(file,list);
 }
 return {issues,used,
  classify(file,bytes,findings){
   file=normalizePayloadPath(file);const items=byPath.get(file);if(!items)return findings;
   seen.add(file);const sha256=createHash('sha256').update(bytes).digest('hex'),bound=items.filter(x=>x.binding===BOUND_EXECUTABLE);let upstreamTuples=null;
   if(bound.length){
    if(bound.length!==items.length||bound.some(x=>x.upstreamSha256!==bound[0].upstreamSha256)){issues.push({code:'safety_public_review_invalid',path:file});return findings;}
    upstreamTuples=verifiedUpstream(bound[0]);
    if(!upstreamTuples){issues.push({code:'safety_public_review_upstream_unavailable',path:file});return findings;}
    if(bound.some(x=>!upstreamTuples.has(tuple(x)))){issues.push({code:'safety_public_review_invalid',path:file});return findings;}
   }else if(items.some(x=>x.sha256!==sha256)){issues.push({code:'safety_public_review_stale',path:file});return findings;}
   for(const item of items)if(!findings.some(f=>f.kind===item.kind&&f.fingerprint===item.fingerprint&&f.occurrences===item.occurrences))issues.push({code:'safety_public_review_stale',path:file,fingerprint:item.fingerprint});
   return findings.map(f=>{
    const review=items.find(x=>x.kind===f.kind&&x.fingerprint===f.fingerprint&&x.occurrences===f.occurrences);
    if(!review||f.kind==='secret'||(upstreamTuples&&!upstreamTuples.has(tuple(f))))return f;
    used.add(file+'|'+f.kind+'|'+f.fingerprint);
    return {...f,disposition:'reviewed_public_data',classification:review.classification,sha256,source:review.source,evidence:review.evidence,reviewer:review.reviewer,reviewedAt:review.reviewedAt};
   });
  },
  unused(){return [...byPath.keys()].filter(p=>!seen.has(p));}
 };
}
