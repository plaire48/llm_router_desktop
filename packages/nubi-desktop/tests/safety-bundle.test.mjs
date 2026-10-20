import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),asar=require('@electron/asar');
const safety=await import('../scripts/check-safety-regression.mjs');
const contact='maintainer'+'@synthetic-project.dev';
test('only an explicit copyright attribution is nonblocking; user contacts and credentials still block',()=>{
 const notice=Buffer.from('MIT License\nCopyright (c) 2026 Synthetic Project <'+contact+'>\nPermission is hereby granted, free of charge');
 const found=safety.scanSensitivePatterns('licenses/MIT-LICENSE.txt',notice,{classifyPublicAttribution:true});
 assert(found.some(x=>x.disposition==='public_attribution'&&x.attribution==='copyright'));
 assert(!JSON.stringify(found).includes(contact));
 const injected=Buffer.concat([notice,Buffer.from('\nUser: personal'+'@private-company.dev\n'+'ghp_'+'Aa19'.repeat(9))]);
 const findings=safety.scanSensitivePatterns('licenses/MIT-LICENSE.txt',injected,{classifyPublicAttribution:true});
 assert(findings.some(x=>x.kind==='secret'&&x.disposition!=='public_attribution'));
 assert(findings.some(x=>x.kind==='email'&&x.disposition!=='public_attribution'));
 assert(safety.scanSensitivePatterns('settings.txt',notice,{classifyPublicAttribution:true}).every(x=>x.disposition!=='public_attribution'));
});
test('the existing signed brand image retains its public certificate issuer contact without changing its bytes',async()=>{
 const file=new URL('../ui/ai-workspace/assets/workspace-mark.png',import.meta.url),bytes=await readFile(file),before=Buffer.from(bytes);
 const found=safety.scanSensitivePatterns('resources/nubi.png',bytes,{classifyPublicAttribution:true});
 assert(found.some(x=>x.attribution==='certificate_issuer'&&x.disposition==='public_attribution'));
 assert(found.every(x=>x.disposition==='public_attribution'));assert(bytes.equals(before));
});
test('bundle inspection reads ASAR members and all extra resources rather than just the compiled source directory',async()=>{
 assert.equal(typeof safety.inspectSafetyBundle,'function');const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-safety-bundle-'));
 try{const app=path.join(dir,'source'),payload=path.join(dir,'win-unpacked');await mkdir(app);await mkdir(path.join(payload,'resources'),{recursive:true});
 await writeFile(path.join(app,'entry.js'),'export const fixture = true;');await asar.createPackage(app,path.join(payload,'resources','app.asar'));
 await writeFile(path.join(payload,'resources','THIRD-PARTY-NOTICES.txt'),'Copyright (c) 2026 Synthetic Project <'+contact+'>');
 let result=await safety.inspectSafetyBundle({directory:payload});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.archiveFiles,1);assert.equal(result.publicAttributions.length,1);
 await writeFile(path.join(app,'entry.js'),'const key = "'+'ghp_'+'Bb29'.repeat(9)+'";');await asar.createPackage(app,path.join(payload,'resources','app.asar'));asar.uncacheAll();
 result=await safety.inspectSafetyBundle({directory:payload});assert.equal(result.ok,false);assert(result.issues.some(x=>x.kind==='secret'&&x.path.includes('app.asar/entry.js')));
 await writeFile(path.join(payload,'resources','extra.txt'),'personal'+'@private-company.dev');result=await safety.inspectSafetyBundle({directory:payload});assert(result.issues.some(x=>x.path.endsWith('extra.txt')));
 }finally{asar.uncacheAll();await rm(dir,{recursive:true,force:true});}
});
test('bundle scan rejects verification evidence and filesystem links rather than following external files',async()=>{
 assert.equal(typeof safety.inspectSafetyBundle,'function');const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-safety-paths-'));
 try{await mkdir(path.join(dir,'verification'));await writeFile(path.join(dir,'verification','old.txt'),'evidence');let result=await safety.inspectSafetyBundle({directory:dir});assert(result.issues.some(x=>x.code==='safety_upload_path'));
 await symlink(os.tmpdir(),path.join(dir,'outside'),'junction');result=await safety.inspectSafetyBundle({directory:dir});assert(result.issues.some(x=>x.code==='safety_bundle_link'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('missing unpacked ASAR files and unsupported compressed payloads fail closed',async()=>{
 assert.equal(typeof safety.inspectSafetyBundle,'function');const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-safety-archive-'));
 try{const src=path.join(dir,'source'),out=path.join(dir,'payload');await mkdir(src);await mkdir(out);await writeFile(path.join(src,'entry.js'),'export const fixture=true;');
 await asar.createPackageWithOptions(src,path.join(out,'app.asar'),{unpack:'*.js'});await rm(path.join(out,'app.asar.unpacked'),{recursive:true});
 let result=await safety.inspectSafetyBundle({directory:out});assert.equal(result.ok,false);assert(result.issues.some(x=>x.code==='safety_source_unavailable'));
 await writeFile(path.join(out,'nested.zip'),Buffer.from([80,75,3,4]));result=await safety.inspectSafetyBundle({directory:out});assert(result.issues.some(x=>x.code==='safety_archive_unsupported'));
 }finally{asar.uncacheAll();await rm(dir,{recursive:true,force:true});}
});
test('yearless MIT copyright and preserved bundled license comments retain attribution without allowing nearby user mail',()=>{
 const license='MIT License\nCopyright (c) Synthetic Project <'+contact+'>\nPermission is hereby granted, free of charge';
 assert(safety.scanSensitivePatterns('licenses/synthetic-LICENSE',Buffer.from(license),{classifyPublicAttribution:true}).every(x=>x.disposition==='public_attribution'));
 const source='/*! Copyright (c) 2026 Synthetic Project <'+contact+'>\n MIT License */\nconst user="personal'+'@private-company.dev";';
 const found=safety.scanSensitivePatterns('backend/vendor.mjs',Buffer.from(source),{classifyPublicAttribution:true});assert(found.some(x=>x.attribution==='copyright'));assert(found.some(x=>x.kind==='email'&&x.disposition!=='public_attribution'));
 const author='/*! @author Synthetic Project <'+contact+'>\n @copyright Synthetic Project 2026\n @license MIT */';
 assert(safety.scanSensitivePatterns('backend/vendor.mjs',Buffer.from(author),{classifyPublicAttribution:true}).every(x=>x.disposition==='public_attribution'));
});
test('a private PNG text contact cannot borrow the public attribution classification from its signed content',async()=>{
 const bytes=await readFile(new URL('../ui/ai-workspace/assets/workspace-mark.png',import.meta.url));
 const text=Buffer.from('Comment\0personal'+'@private-company.dev'),chunk=Buffer.alloc(text.length+12);chunk.writeUInt32BE(text.length);chunk.write('tEXt',4);text.copy(chunk,8);
 const combined=Buffer.concat([bytes.subarray(0,8),chunk,bytes.subarray(8)]),found=safety.scanSensitivePatterns('resources/synthetic.png',combined,{classifyPublicAttribution:true});
 assert(found.some(x=>x.attribution==='certificate_issuer'));assert(found.some(x=>x.projection==='png-tEXt'&&x.disposition!=='public_attribution'));
});
test('truncated PNG metadata fails closed rather than being skipped as compressed pixels',()=>{
 const bytes=Buffer.from([137,80,78,71,13,10,26,10,0,0]);assert(safety.scanSensitivePatterns('synthetic.png',bytes).some(x=>x.code==='safety_metadata_invalid'));
});
test('internal framework aliases are inspected once while paths escaping the payload still block',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-safety-alias-'));
 try{await mkdir(path.join(dir,'Versions','A'),{recursive:true});await writeFile(path.join(dir,'Versions','A','Framework'),'synthetic runtime');await symlink(path.join(dir,'Versions','A'),path.join(dir,'Current'),'junction');
 const found=await safety.inspectSafetyBundle({directory:dir});assert.equal(found.ok,true,JSON.stringify(found));assert.equal(found.checked,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('an internal ASAR alias cannot bypass archive member inspection',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-safety-asar-alias-'));
 try{const src=path.join(dir,'source'),out=path.join(dir,'payload');await mkdir(src);await mkdir(out);await writeFile(path.join(src,'entry.js'),'const key="'+'ghp_'+'Cc39'.repeat(9)+'";');await asar.createPackage(src,path.join(out,'z.asar'));await symlink(path.join(out,'z.asar'),path.join(out,'a.asar'));
 const found=await safety.inspectSafetyBundle({directory:out});assert.equal(found.archiveFiles,1);assert(found.issues.some(x=>x.kind==='secret'&&x.path.includes('z.asar/entry.js')));
 }finally{asar.uncacheAll();await rm(dir,{recursive:true,force:true});}
});
