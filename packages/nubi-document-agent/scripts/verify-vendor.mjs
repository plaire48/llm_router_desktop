import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,join,isAbsolute} from 'node:path';

const root=resolve(process.argv[2]??fileURLToPath(new URL('..',import.meta.url)));
try {
  const manifest=JSON.parse(await readFile(join(root,'vendor/genoffice-source.json'),'utf8'));
  if(manifest.repository!=='https://github.com/genspark-ai/genoffice'||!/^[a-f0-9]{40}$/.test(manifest.commit)||manifest.modifications?.length!==0)throw Error();
  const entries=Object.entries(manifest.files??{});
  if(!entries.length||!manifest.files.LICENSE||!manifest.files.NOTICE)throw Error();
  for(const [relative,expected] of entries){
    if(isAbsolute(relative)||relative.split(/[\\/]/).includes('..')||!/^[a-f0-9]{64}$/.test(expected))throw Error();
    const path=join(root,'vendor/genoffice',relative);
    if(!(await lstat(path)).isFile())throw Error();
    const hash=createHash('sha256').update(await readFile(path)).digest('hex');
    if(hash!==expected)throw Error();
  }
  process.stdout.write(`Verified ${entries.length} pinned GenOffice files at ${manifest.commit}\n`);
} catch {
  process.stderr.write('vendor_integrity_failed\n');process.exitCode=1;
}
