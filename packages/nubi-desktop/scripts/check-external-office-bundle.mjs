import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(await readFile('generated/external-office-native/manifest.json','utf8'));
for(const [file,expected]of Object.entries(manifest.sourceFiles))assert.equal(hash(await readFile(file)),expected,'native bridge source changed since build');
const checked=[];
for(const root of ['generated/external-office-native','extension/lib/node/external-office-native','electron-app/lib/backend/external-office-native']){
 for(const [name,expected]of Object.entries(manifest.files)){const bytes=await readFile(path.join(root,name));assert.equal(hash(bytes),expected,root+'/'+name);assert.equal(bytes.subarray(0,2).toString(),'MZ','Windows PE image');checked.push(root+'/'+name);}
 assert.match(await readFile(path.join(root,'THIRD-PARTY-NOTICES.txt'),'utf8'),/Permission is hereby granted/);
}
const result={ok:true,checked,sourceHashesVerified:true,windowsRuntimeVerified:false,office2016Verified:false,nascaVerified:false};await mkdir('../../artifacts/external-office-2026-10-17',{recursive:true});await writeFile('../../artifacts/external-office-2026-10-17/bundle.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
