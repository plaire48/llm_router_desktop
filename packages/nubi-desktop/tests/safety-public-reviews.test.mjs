import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {inspectSafetyBundle,scanSensitivePatterns} from '../scripts/check-safety-regression.mjs';
import {createPublicReviewIndex} from '../scripts/safety-public-reviews.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function sample(fn){const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-safety-review-'));try{const bytes=Buffer.from('public-example'+'@synthetic-project.dev');await writeFile(path.join(dir,'sample.txt'),bytes);const finding=scanSensitivePatterns('sample.txt',bytes)[0];const review={path:'sample.txt',sha256:hash(bytes),kind:'email',fingerprint:finding.fingerprint,occurrences:1,classification:'public_example',source:{url:'https://github.com/synthetic-project/synthetic/blob/v1/sample.txt',integrity:'sha256-'+hash(bytes),artifactPath:'sample.txt'},evidence:'Synthetic test of the review contract, no real upstream claim',reviewer:'test',reviewedAt:'2026-10-20'};await fn({dir,bytes,review});}finally{await rm(dir,{recursive:true,force:true});}}
test('reviewed public data is nonblocking only for the exact file bytes and finding',async()=>sample(async({dir,bytes,review})=>{
 const accepted=await inspectSafetyBundle({directory:dir,publicReviews:{version:1,findings:[review]}});assert.equal(accepted.ok,true);assert.equal(accepted.reviewedPublicFindings.length,1);assert.equal(accepted.issues.length,0);
 await writeFile(path.join(dir,'sample.txt'),Buffer.concat([bytes,Buffer.from('\nprivate'+'@private-company.dev')]));const changed=await inspectSafetyBundle({directory:dir,publicReviews:{version:1,findings:[review]}});assert.equal(changed.ok,false);assert(changed.issues.some(x=>x.kind==='email'));assert.equal(changed.reviewedPublicFindings.length,0);
}));
test('reviews cannot authorize key patterns, missing provenance, fingerprints from another file or duplicate declarations',async()=>sample(async({dir,review})=>{
 for(const changed of [{...review,source:{}},{...review,fingerprint:'f'.repeat(16)},{...review,kind:'secret'}]){const result=await inspectSafetyBundle({directory:dir,publicReviews:{version:1,findings:[changed]}});assert.equal(result.ok,false);}
 const dup=await inspectSafetyBundle({directory:dir,publicReviews:{version:1,findings:[review,review]}});assert.equal(dup.ok,false);
 await writeFile(path.join(dir,'key.txt'),'ghp_'+'Dd49'.repeat(9));const result=await inspectSafetyBundle({directory:dir,publicReviews:{version:1,findings:[review]}});assert(result.issues.some(x=>x.kind==='secret'));
}));
test('a blocking bundle finding carries the exact file hash for review pinning',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'safety-hash-'));try{
  const bytes=Buffer.from('author '+'someone'+'@public-upstream.dev');await writeFile(path.join(dir,'notice.txt'),bytes);
  const result=await inspectSafetyBundle({directory:dir,publicReviews:{version:1,findings:[]}});
  const finding=result.issues.find(x=>x.code==='safety_sensitive_pattern');assert.equal(result.ok,false);
  assert.equal(finding.sha256,createHash('sha256').update(bytes).digest('hex'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('packaged executable reviews bind to the pinned upstream bytes; new values and changed upstream still block',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'safety-bound-'));try{
  const upstreamDir=path.join(root,'dist'),payload=path.join(root,'payload');await mkdir(upstreamDir);await mkdir(payload);
  const value='author '+'upstream'+'@public-upstream.dev',upstream=Buffer.from('MZ upstream '+value+' end');
  await writeFile(path.join(upstreamDir,'electron.exe'),upstream);
  const finding=scanSensitivePatterns('App.exe',upstream)[0];
  const review={path:'App.exe',binding:'packaged_electron_executable',upstreamSha256:hash(upstream),kind:finding.kind,fingerprint:finding.fingerprint,occurrences:1,classification:'public_package_attribution',source:{url:'https://example.com/electron.zip',integrity:'sha256-'+'0'.repeat(64),artifactPath:'electron.exe'},evidence:'Upstream attribution present in the pinned upstream executable.',reviewer:'test',reviewedAt:'2026-10-21'};
  const manifest={version:1,findings:[review]};
  // Packaging edits change other bytes (resources, fuses, integrity hash) but not the reviewed value.
  await writeFile(path.join(payload,'App.exe'),Buffer.from('MZ packaged-resources '+value+' fuse-edit'));
  let result=await inspectSafetyBundle({directory:payload,publicReviews:manifest,upstreamRoot:upstreamDir});
  assert.equal(result.ok,true,JSON.stringify(result.issues));assert.equal(result.reviewedPublicFindings.length,1);
  // A value that is not in the upstream executable blocks even though the reviewed one passes.
  await writeFile(path.join(payload,'App.exe'),Buffer.from('MZ packaged '+value+' '+'private'+'@private-company.dev'));
  result=await inspectSafetyBundle({directory:payload,publicReviews:manifest,upstreamRoot:upstreamDir});
  assert.equal(result.ok,false);assert(result.issues.some(x=>x.code==='safety_sensitive_pattern'&&x.fingerprint!==finding.fingerprint));
  // Upstream bytes that do not match the pinned hash are never trusted.
  await writeFile(path.join(payload,'App.exe'),Buffer.from('MZ packaged '+value));await writeFile(path.join(upstreamDir,'electron.exe'),Buffer.concat([upstream,Buffer.from('x')]));
  result=await inspectSafetyBundle({directory:payload,publicReviews:manifest,upstreamRoot:upstreamDir});
  assert(result.issues.some(x=>x.code==='safety_public_review_upstream_unavailable'));assert(result.issues.some(x=>x.code==='safety_sensitive_pattern'));
  // The binding is limited to a top-level executable.
  const nested=createPublicReviewIndex({version:1,findings:[{...review,path:'resources/App.exe'}]});assert(nested.issues.some(x=>x.code==='safety_public_review_invalid'));
 }finally{await rm(root,{recursive:true,force:true});}
});
