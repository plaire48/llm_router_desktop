// Offline pipeline benchmark. No model calls, user screenshots or product edits.
import {build,stop} from 'esbuild';
import {chromium,_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
const require=createRequire(import.meta.url),out=path.resolve('verification/capture-benchmark-2026-10-16');await mkdir(out,{recursive:true});
const cases=[{name:'standard',width:1440,height:900,dpr:1},{name:'retina-4k',width:1920,height:1080,dpr:2},{name:'retina-8k',width:3840,height:2160,dpr:2}];
const roi={x:300,y:170,width:720,height:440},text=['담당자 김민서','상태 검토대기','납기 2026-11-03','합계 12,845,900','코드 Q7B4-19XZ'];
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#f1f7fe;color:#191f28;font:12px 'Apple SD Gothic Neo',Arial,sans-serif}header{height:52px;background:white;border-bottom:1px solid #e5e8eb;padding:18px}aside{position:absolute;top:52px;bottom:0;width:240px;padding:24px;background:#fff}.data{position:absolute;left:270px;right:30px;top:80px;display:grid;grid-template-columns:repeat(12,1fr);gap:8px}.cell{padding:12px;border:1px solid #e5e8eb;background:#fff}.target{position:absolute;left:${roi.x}px;top:${roi.y}px;width:${roi.width}px;height:${roi.height}px;padding:24px;background:white;border:1px solid #3182f6}.target p{line-height:1.8;margin:8px 0}.small{font-size:10px}</style><header>누비 합성 업무 화면 | 실제 사용자 자료 없음</header><aside>프로젝트<br><br>메일<br><br>위키<br><br>파일</aside><div class="data">${Array.from({length:700},(_,i)=>`<div class="cell">항목 ${i+1}<br>요청 상태 확인<br>12,000</div>`).join('')}</div><section class="target"><h3>선택할 업무 상세</h3>${text.map(s=>`<p>${s}</p>`).join('')}<p class="small">작은 글자 검증: 경계 조건과 오류 메시지를 확인하세요.</p><p>주변 목록과 탐색 메뉴는 이번 질문에 필요하지 않습니다.</p></section>`;
await writeFile(path.join(out,'screen.html'),html);
let browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const c of cases){const ctx=await browser.newContext({viewport:{width:c.width,height:c.height},deviceScaleFactor:c.dpr});const p=await ctx.newPage();await p.goto('file://'+path.join(out,'screen.html'));await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:path.join(out,c.name+'-source.png')});await ctx.close();}}finally{await browser.close();}
await writeFile(path.join(out,'host.cjs'),`const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{new BrowserWindow({show:false}).loadURL('data:text/html,benchmark');});`);
const app=await electron.launch({executablePath:require('electron'),args:[path.join(out,'host.cjs')],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
const rows=[];
try{for(const c of cases){rows.push(await app.evaluate(({nativeImage},{out,c,roi,source})=>{
 const fs=process.getBuiltinModule('fs'),req=process.getBuiltinModule('module').createRequire(source),{captureImage}=req(source);
 const image=nativeImage.createFromPath(out+'/'+c.name+'-source.png'),size=image.getSize(),bitmap=image.toBitmap(),samples={full:[],preview:[],region:[]};
 let full,preview,region;
 for(let i=0;i<10;i++)for(const [mode,options] of [['full',{maxWidth:2400}],['preview',{maxWidth:size.width<=1600?2400:1280}],['region',{maxWidth:2400,clip:roi}]]){
  // capturePage provides raw pixels. A NativeImage loaded from a PNG can reuse
  // the encoded source in toPNG(), which would bias the no-resize baseline.
  const frame=nativeImage.createFromBitmap(bitmap,size);
  const start=performance.now(),shot=captureImage(frame,options,{width:c.width,height:c.height}),ms=performance.now()-start;
  if(i>0)samples[mode].push(ms);
  if(mode==='full')full=shot;else if(mode==='preview')preview=shot;else region=shot;
 }
 fs.writeFileSync(out+'/'+c.name+'-preview.json',JSON.stringify(full));fs.writeFileSync(out+'/'+c.name+'-region.png',Buffer.from(region.image,'base64'));
 const stat=values=>{const sorted=values.toSorted((a,b)=>a-b);return {medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],samples:values};};
 const inspect=shot=>({width:shot.width,height:shot.height,pngBytes:Buffer.byteLength(shot.image,'base64'),base64Chars:shot.image.length});
 return {name:c.name,viewport:{width:c.width,height:c.height},dpr:c.dpr,source:size,rawBitmapBytes:size.width*size.height*4,full:{...inspect(full),...stat(samples.full)},lightPreview:{...inspect(preview),...stat(samples.preview)},nativeRegion:{...inspect(region),...stat(samples.region)}};
 },{out,c,roi,source:path.resolve('electron-app/capture-image.cjs')}));}}finally{await app.close();}
await build({stdin:{contents:`import {cropCapture} from ${JSON.stringify(path.resolve('ui/captures.js'))};window.cropCapture=cropCapture;`,resolveDir:process.cwd(),loader:'js'},outfile:path.join(out,'crop.js'),bundle:true,format:'esm',platform:'browser'});
await writeFile(path.join(out,'crop.html'),'<!doctype html><script type="module" src="crop.js"></script>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(out,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(out+path.sep))throw Error();res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
browser=await chromium.launch({channel:'chrome',headless:true});
try{const p=await browser.newPage();await p.goto('http://127.0.0.1:'+server.address().port+'/crop.html');await p.waitForFunction(()=>window.cropCapture);
 for(const row of rows){const shot=JSON.parse(await readFile(path.join(out,row.name+'-preview.json'),'utf8'));
  const result=await p.evaluate(async({shot,roi,viewport})=>{const scale=shot.width/viewport.width,rect={x:roi.x*scale,y:roi.y*scale,width:roi.width*scale,height:roi.height*scale,imagePixels:true},times=[];let crop;
   for(let i=0;i<10;i++){const start=performance.now();crop=await window.cropCapture(shot,rect);if(i>0)times.push(performance.now()-start);}
   const sorted=times.toSorted((a,b)=>a-b);return {width:crop.width,height:crop.height,image:crop.image,pngBytes:atob(crop.image).length,medianMs:sorted[4],p95Ms:sorted[8],samples:times};
  },{shot,roi,viewport:row.viewport});
  await writeFile(path.join(out,row.name+'-current.png'),Buffer.from(result.image,'base64'));delete result.image;row.currentRegion=result;
  row.nativeCropPixelRatio=(row.nativeRegion.width*row.nativeRegion.height)/(result.width*result.height);
  row.currentProcessingMedianMs=row.full.medianMs+row.currentRegion.medianMs;
  row.proposedFrozenProcessingMedianMs=row.lightPreview.medianMs+row.nativeRegion.medianMs;
  console.log(JSON.stringify({name:row.name,current:[result.width,result.height],region:[row.nativeRegion.width,row.nativeRegion.height],currentProcessingMs:row.currentProcessingMedianMs,proposedProcessingMs:row.proposedFrozenProcessingMedianMs}));
 }
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));stop();}
await writeFile(path.join(out,'result.json'),JSON.stringify({scope:'Synthetic Korean text screenshots. Fresh raw-bitmap NativeImage per sample, actual Nubi native captureImage and renderer cropCapture. Nine warmed samples per stage. Stage medians summed, not end-to-end measurements. No model/OCR score, IPC, frame acquisition, bitmap construction or human selection delay included.',roi,text,rows},null,2)+'\n');
