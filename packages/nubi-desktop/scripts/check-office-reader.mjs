import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
const file=fileURLToPath(new URL('../runtime/office-document.ps1',import.meta.url));
export function checkOfficeReader({binary}={}){
 const required=!!binary||process.platform==='win32';
 binary ||= process.platform==='win32'?'powershell.exe':'pwsh';
 const source=readFileSync(new URL('./check-office-reader.ps1',import.meta.url),'utf8');
 // Literal path argument, no shell expansion or execution-policy change.
 const quote=value=>"'"+value.replaceAll("'","''")+"'";
 const command=`& { ${source}\n} -File ${quote(file)}`;
 const child=spawnSync(binary,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8',timeout:20000,maxBuffer:1024*1024,windowsHide:true});
 if(child.error?.code==='ENOENT'&&!required)return {skipped:true,reason:'PowerShell unavailable; Windows build requires its native parser'};
 if(child.error)throw Error('office_reader_check_unavailable');
 let result;try{result=JSON.parse(child.stdout.replace(/^\uFEFF/,''));}catch{throw Error('office_reader_check_invalid');}
 if(child.status!==0||result.ok!==true)throw Object.assign(Error('office_reader_check_failed'),{details:result});
 return result;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 try{const at=process.argv.indexOf('--powershell');console.log(JSON.stringify(checkOfficeReader({binary:at>=0?process.argv[at+1]:undefined})));}
 catch(error){console.error(JSON.stringify({error:error.message,...(error.details?{details:error.details}:{})}));process.exitCode=1;}
}
