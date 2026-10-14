const {readFile,stat}=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const INSTALLATION_MARKER='nubi-installation.id';
async function installationStamp({packaged,platform,executable}){
 if(!packaged||platform!=='win32')return '';
 try{
  const marker=path.join(path.dirname(executable),INSTALLATION_MARKER);
  const info=await stat(marker);if(info.isFile()&&info.size<=128){const value=(await readFile(marker,'utf8')).trim().replace(/^\{|\}$/g,'').toLowerCase();if(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value))return value;}
 }catch{/* Older installers have no marker. */}
 try{
  const info=await stat(executable);
  return createHash('sha256').update(`${executable}:${info.birthtimeMs}:${info.ctimeMs}:${info.size}`).digest('hex');
 }catch{return '';}
}
module.exports={INSTALLATION_MARKER,installationStamp};
