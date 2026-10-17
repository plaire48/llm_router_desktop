import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../tests/fixtures.mjs';
import {ExternalOffice} from '../runtime/external-office.mjs';
const out=path.resolve('../../output/playwright/external-office-2026-10-17');await mkdir(out,{recursive:true});
await build({entryPoints:['tests/external-office-ui-fixture.jsx'],outfile:path.join(out,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'}});
await writeFile(path.join(out,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const cleanup=[],{service}=await fixture({after:fn=>cleanup.push(fn)}),projectId=service.projectId;
const office=new ExternalOffice({open:async({app,onExit})=>{let alive=true;return {environment:'windows-office',app,documentId:'doc',documentTitle:({word:'사업 검토 보고서.docx',excel:'2026년 분기실적.xlsx',powerpoint:'사업 제안.pptx'})[app],officeSessionId:crypto.randomUUID(),officeVersion:'16.0 (fixture)',isAlive:()=>alive,call:async()=>({status:'verified',saved:true}),close(){if(alive){alive=false;onExit();}}};}});
const server=createServer(async(req,res)=>{try{
 if(req.method==='POST'&&req.url==='/request'){let body='';for await(const part of req)body+=part;const {method,args={}}=JSON.parse(body);let result;
  if(method==='externalOffice')result=await office.request(service,{...args,projectId});
  else if(method==='create')result=await service.createTask({request:'연결한 문서 작업'});
  else if(method==='task')result=service.task(args.taskId);
  else if(method==='listSkills')result={skills:[]};else result={};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
 }
 const name=req.url==='/'?'index.html':decodeURIComponent(req.url.slice(1)),file=path.resolve(out,name);if(!file.startsWith(out+path.sep))throw Error('path_invalid');res.setHeader('Content-Type',name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'font/woff2');res.end(await readFile(file));
 }catch(error){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.message}));}});
server.listen(4398,'127.0.0.1',()=>console.log('External Office UI fixture: http://127.0.0.1:4398'));
async function close(){server.close();office.dispose();for(const fn of cleanup.reverse())await fn();process.exit(0);}process.on('SIGTERM',close);process.on('SIGINT',close);
