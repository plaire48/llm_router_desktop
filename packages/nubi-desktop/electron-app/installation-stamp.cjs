const {readFile,stat}=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const INSTALLATION_MARKER='nubi-installation.id';
function markerId(bytes){
 const utf16=bytes[0]===0xff&&bytes[1]===0xfe;
 const value=bytes.toString(utf16?'utf16le':'utf8').replace(/^\uFEFF/,'').trim().replace(/^\{|\}$/g,'').toLowerCase();
 return /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)?value:'';
}
async function installationStamp({packaged,platform,executable}){
 if(!packaged||platform!=='win32')return '';
 let marker='';
 try{
  const file=path.join(path.dirname(executable),INSTALLATION_MARKER);
  const info=await stat(file);if(info.isFile()&&info.size<=128)marker=markerId(await readFile(file));
 }catch{/* Older installers have no marker. */}
 try{
  const info=await stat(executable);
  // Also observe payload replacement: an older/custom installer may preserve a
  // valid marker from a previous installation. Normal launches stay stable.
  return createHash('sha256').update(`${marker}:${executable}:${info.birthtimeMs}:${info.ctimeMs}:${info.size}`).digest('hex');
 }catch{return marker;}
}
module.exports={INSTALLATION_MARKER,installationStamp,markerId};
