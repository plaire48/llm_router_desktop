import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
// Exactly 30,000 synthetic source candidates, plus the ignore control file.
export async function generateBigRepository(root){
 await mkdir(root,{recursive:true});await writeFile(path.join(root,'.openwikiignore'),'ignored/\n.openwikiignore\n');await writeFile(path.join(root,'README.md'),'# Synthetic repository\n');await writeFile(path.join(root,'package.json'),JSON.stringify({name:'synthetic-big',main:'src0/index.mjs'}));
 for(const [folder,total] of [['ignored',22000],...Array.from({length:8},(_,i)=>['src'+i,i===0?998:1000])]){
  const dir=path.join(root,folder);await mkdir(dir);for(let start=0;start<total;start+=64)await Promise.all(Array.from({length:Math.min(64,total-start)},(_,offset)=>{const index=start+offset;return writeFile(path.join(dir,index===0?'index.mjs':'file-'+index+'.mjs'),`// Synthetic module ${index}\nexport const value = ${index};\n`);}));
 }
}
