import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const result=spawnSync(process.env.NUBI_DOTNET||'dotnet',['build','native/TextEditorBridge/TextEditorBridge.csproj','-c','Release','--ignore-failed-sources','-o','generated/text-editor-bridge'],{stdio:'inherit'});if(result.error)throw result.error;if(result.status)throw Error('editor_native_build_failed');
const file='Nubi.TextEditorBridge.exe',bytes=await readFile('generated/text-editor-bridge/'+file);await writeFile('generated/text-editor-bridge/manifest.json',JSON.stringify({protocol:1,file,sha256:createHash('sha256').update(bytes).digest('hex')}));
