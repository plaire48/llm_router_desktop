import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {findClaudeBinary,runClaude} from '../runtime/claude-code.mjs';
const exec=promisify(execFile);
if(process.platform!=='win32')throw Error('windows_required');
const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-claude-check-'));
try{
 const home=path.join(dir,'홍 길동'),prefix=path.join(home,'AppData','Roaming','npm');
 // setup-node includes npm next to node.exe. Use argv so a Korean/spaced
 // installation path is not reinterpreted by cmd.exe before npm receives it.
 const npmCli=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
 await exec(process.execPath,[npmCli,'install','--global','--prefix',prefix,'@anthropic-ai/claude-code@2.1.296','--no-audit','--no-fund'],{timeout:180000,maxBuffer:1000000,windowsHide:true});
 const binary=await findClaudeBinary({platform:'win32',home,environment:{Path:path.join(process.env.SystemRoot,'System32')},registeredPath:''});
 assert(binary.startsWith(prefix));assert(binary.endsWith('.exe'));
 const version=(await runClaude(binary,['--version'],{timeoutMs:20000})).trim();assert.match(version,/2\.1\.296/);
 const legacy=path.join(dir,'legacy cli.js');await writeFile(legacy,'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
 const argv=['--schema','{"text":"한글 %PATH% & echo literal | >"}'];
 assert.deepEqual(JSON.parse(await runClaude(legacy,argv)),argv);
 await mkdir('verification',{recursive:true});await writeFile('verification/windows-claude.json',JSON.stringify({officialNpmVersion:version,withoutInheritedNpmPath:true,koreanSpacePath:true,legacyArgvPreserved:true,login:'not tested',model:'not tested'},null,2));
 console.log('Windows Claude: official npm binary discovered without npm PATH; Korean/spaced path and legacy argv verified.');
}finally{await rm(dir,{recursive:true,force:true});}
