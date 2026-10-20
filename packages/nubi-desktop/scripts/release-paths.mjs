import {cp,readdir} from 'node:fs/promises';import path from 'node:path';
export const includeReleasePath=file=>!String(file).replaceAll('\\','/').split('/').includes('verification');
export async function copyReleaseTree(source,destination,options={}){return cp(source,destination,{...options,filter:async file=>includeReleasePath(file)&&(!options.filter||await options.filter(file))});}
export async function assertReleaseTree(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(!includeReleasePath(file))throw Error('release_verification_payload');if(entry.isDirectory())await assertReleaseTree(file);}}
