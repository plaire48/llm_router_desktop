import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,cp,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const script=new URL('../scripts/verify-vendor.mjs',import.meta.url);
test('the pinned upstream source and notices pass integrity verification',()=>{
  const result=spawnSync(process.execPath,[script.pathname],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Verified \d+ pinned GenOffice files/);
});
test('an upstream source modification fails integrity verification',async()=>{
  const root=await mkdtemp(join(tmpdir(),'nubi-document-vendor-'));
  try {
    await cp(new URL('../vendor',import.meta.url),join(root,'vendor'),{recursive:true});
    await appendFile(join(root,'vendor/genoffice/packages/agent-core/src/loop.ts'),'\n// Unexpected change\n');
    const result=spawnSync(process.execPath,[script.pathname,root],{encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/vendor_integrity_failed/);
  } finally {await rm(root,{recursive:true,force:true});}
});
