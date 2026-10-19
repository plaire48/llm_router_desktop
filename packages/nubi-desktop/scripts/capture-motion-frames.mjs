// Visual-only animation-time samples. These are not performance samples and
// are never read by a gate; uninterrupted timings stay in check-motion-quality.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const tag=process.env.MOTION_TAG||'after-15';if(!/^[a-z0-9-]+$/.test(tag))throw Error('invalid tag');
const root=path.resolve('verification/motion-1.3.0/'+tag),out=path.join(root,'visual-frames');await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(root+path.sep))throw Error();const body=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream'}).end(body);}catch{res.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true}),records=[];
try{for(const width of [1280,440]){
 const page=await browser.newPage({viewport:{width,height:900}});await page.addInitScript(()=>Object.defineProperty(navigator,'webdriver',{get:()=>false}));await page.goto(`http://127.0.0.1:${server.address().port}/?catalog&integrated`);await page.waitForFunction(()=>!document.querySelector('.nubi-connecting,.nubi-intro'));await page.locator('.welcome').waitFor();await page.evaluate(()=>document.fonts.ready);
 await page.getByRole('button',{name:'설정',exact:true}).click();await page.getByRole('dialog',{name:'설정',exact:true}).waitFor();
 await page.locator('.cx-panel-backdrop').evaluate(backdrop=>{window.visualAnimations=[...backdrop.getAnimations(),...backdrop.querySelector(':scope > .cx-detail-panel').getAnimations()];for(const a of window.visualAnimations)a.pause();});
 for(const at of [0,70,140,280]){const sample=await page.evaluate(at=>window.visualAnimations.map(a=>{a.currentTime=at;return {name:a.animationName,duration:a.effect.getTiming().duration,at:a.currentTime};}),at);await page.screenshot({path:path.join(out,`modal-enter-${width}-${at}ms.png`)});records.push({width,at,sample});}
 await page.evaluate(()=>{for(const a of window.visualAnimations)a.finish();});await page.keyboard.press('Escape');await page.waitForTimeout(320);await page.close();
}}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
await writeFile(path.join(out,'samples.json'),JSON.stringify({boundary:'Visual-only paused Animation samples; never performance measurements.',records},null,2));
