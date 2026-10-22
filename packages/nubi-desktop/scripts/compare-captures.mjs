// Visual equality gate for CSS work (plan 2a): compares two folders of PNG captures pixel by pixel with Chrome's own
// decoder. A pixel counts when any channel differs by more than 8. Run-to-run noise measured in plan 1 is allowed.
import {chromium} from 'playwright';
import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export const CAPTURE_NOISE=Object.freeze({default:20,animated:{'bird-hover.png':8000,'mail-flow-ai.png':6000,'mail-flow-reconnected.png':6000,'project-start-1280.png':600}});
export async function compareCaptures(beforeDir,afterDir,{noise=CAPTURE_NOISE}={}){
 const names=(await readdir(beforeDir)).filter(name=>name.endsWith('.png')).sort(),changed=[];
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();
  for(const name of names){
   let after;try{after=await readFile(path.join(afterDir,name));}catch{changed.push({name,pixels:-1});continue;}
   const before=await readFile(path.join(beforeDir,name));
   const pixels=await page.evaluate(async([a,b])=>{
    const load=async data=>{const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const canvas=new OffscreenCanvas(image.width,image.height),context=canvas.getContext('2d');context.drawImage(image,0,0);return {width:image.width,height:image.height,data:context.getImageData(0,0,image.width,image.height).data};};
    const p=await load(a),q=await load(b);if(p.width!==q.width||p.height!==q.height)return -2;
    let count=0;for(let i=0;i<p.data.length;i+=4)if(Math.abs(p.data[i]-q.data[i])>8||Math.abs(p.data[i+1]-q.data[i+1])>8||Math.abs(p.data[i+2]-q.data[i+2])>8||Math.abs(p.data[i+3]-q.data[i+3])>8)count++;
    return count;},[before.toString('base64'),after.toString('base64')]);
   const allowed=noise.animated?.[name]??noise.default;
   if(pixels<0||pixels>allowed)changed.push({name,pixels});
  }
 }finally{await browser.close();}
 return {compared:names.length,changed};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [before,after]=process.argv.slice(2).filter(arg=>!arg.startsWith('--'));const noiseAt=process.argv.indexOf('--noise');
 // --noise <json>: a calibrated per-file allowance ({default, animated:{name:pixels}}) for captures with known run-to-run noise.
 const noise=noiseAt>0?JSON.parse(await readFile(process.argv[noiseAt+1],'utf8')):CAPTURE_NOISE;
 const result=await compareCaptures(before,after,{noise});
 console.log(JSON.stringify(result));process.exitCode=result.changed.length?1:0;
}
