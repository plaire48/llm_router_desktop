// Temporary folders removed once, after every test of the file and its own close hooks have run. node:test runs a
// test's after hooks in the order they were registered, so a fixture that registers its rm first deleted folders whose
// databases a later hook had not closed yet. macOS allows that; Windows refuses with EBUSY (Windows gates, 2026-10-21).
import {after} from 'node:test';
import {rm} from 'node:fs/promises';
const folders=new Set();
after(async()=>{for(const folder of folders)await rm(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
export function removeLater(folder){folders.add(folder);}
