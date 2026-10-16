const {createHash}=require('node:crypto');
const {readFile,mkdir,writeFile,rename,stat}=require('node:fs/promises');
const path=require('node:path');
// Delivery receipts only: no titles, messages, project paths or credentials.
function createNotificationHistory(file){
 const entries=new Map();let pending=Promise.resolve();
 const key=(kind,id)=>createHash('sha256').update(`${kind}\0${id}`).digest('hex');
 const ready=(async()=>{try{if((await stat(file)).size>1024*1024)return;const data=JSON.parse(await readFile(file,'utf8'));if(data.version!==1||!Array.isArray(data.entries))return;for(const entry of data.entries.slice(-4096))if(Array.isArray(entry)&&/^[a-f0-9]{64}$/.test(entry[0])&&Number.isFinite(entry[1]))entries.set(entry[0],entry[1]);}catch{}})();
 function save(){pending=pending.then(async()=>{await ready;await mkdir(path.dirname(file),{recursive:true});const temp=file+'.tmp';await writeFile(temp,JSON.stringify({version:1,entries:[...entries]}),{mode:0o600});await rename(temp,file);}).catch(()=>{});}
 return {ready,has:(kind,id)=>entries.has(key(kind,id)),
  add(kind,id){entries.set(key(kind,id),Date.now());while(entries.size>4096)entries.delete(entries.keys().next().value);save();},
  delete(kind,id){entries.delete(key(kind,id));save();},flush:()=>pending};
}
module.exports={createNotificationHistory};
