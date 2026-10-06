import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,cp,readFile,writeFile,appendFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const checks = [], requests = [];
const rule = 'Only resident applicants aged at least 18 qualify. Temporary visitors are excluded. ';
const server = createServer((req,res) => {
  requests.push(req.url); res.setHeader('Content-Type','text/html; charset=utf-8');
  const ghost = req.url === '/ghost';
  res.end(`<title>Eligibility manual</title><main><h1>${ghost ? 'Details' : 'Eligibility'}</h1><p>${(ghost ? 'Only resident applicants qualify. ' : rule).repeat(150)}</p></main>`);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(),'nubi-retrieval-context-')), extension = resolve(profile,'extension');
const output = process.env.NUBI_VERIFICATION_DIR || 'verification/retrieval-context-browser';
let context;
try {
  await cp(resolve(process.env.NUBI_EXTENSION_DIR || 'dist'),extension,{recursive:true});
  const manifest = JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  await appendFile(resolve(extension,'background.js'),`\nglobalThis.retrievalProbe={ready:serial(()=>Promise.resolve()),host:nativeResearchBrowser({checkOwner:async owner=>{if(owner!=='fixture-owner')throw Error('interrupted');}})};\n`);
  context = await chromium.launchPersistentContext(profile,{headless:true,
    ...(process.env.CHROME_BINARY?{executablePath:process.env.CHROME_BINARY}:{channel:'chromium'}),
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{await retrievalProbe.ready;});
  const transport = op => worker.evaluate(async op=>retrievalProbe.host.execute('fixture-owner',op),op);
  const id = 'retrieval-worker-1';
  await transport({worker_id:id,operation:'open',url:`${origin}/rules`});
  const first = await transport({worker_id:id,operation:'read',args:{query:'Eligibility'}});
  const row = first.ranges[0];
  checks.push({name:'heading lookup includes qualification and exclusion in one bounded native content read',
    passed:!!row && row.markdown.includes('aged at least 18') && row.markdown.includes('Temporary visitors are excluded') && row.markdown.length<=5000 && first.coverage.partial===true,
    returnedCharacters:row?.markdown.length || 0});
  const repeat = await transport({worker_id:id,operation:'read',args:{query:'Eligibility'}});
  assert.deepEqual(repeat.ranges,first.ranges);
  const tab = await worker.evaluate(async()=> (await chrome.tabs.query({})).find(tab=>tab.url?.endsWith('/rules')).id);
  const page = context.pages().find(page=>page.url()===`${origin}/rules`);
  await page.evaluate(()=>{document.querySelector('p').textContent=document.querySelector('p').textContent.replaceAll('Temporary visitors are excluded.','Temporary visitors are admitted.');});
  const changed = await transport({worker_id:id,operation:'read',args:{query:'Eligibility',content_hash:first.content_hash}});
  const fresh = await transport({worker_id:id,operation:'read',args:{query:'admitted'}});
  checks.push({name:'same-document text mutation invalidates a prior hash before index reuse; a fresh query observes the new rule',
    passed:changed.error==='browser_content_changed' && fresh.content_hash!==first.content_hash && fresh.ranges.some(range=>range.markdown.includes('Temporary visitors are admitted.'))});
  await page.reload();
  const reloaded = await transport({worker_id:id,operation:'read',args:{query:'Eligibility',content_hash:fresh.content_hash}});
  checks.push({name:'same-URL reload cannot reuse the previous document continuation',passed:reloaded.error==='browser_content_changed'});
  await transport({worker_id:id,operation:'close'});
  await transport({worker_id:'retrieval-worker-2',operation:'open',url:`${origin}/ghost`});
  const ghost = await transport({worker_id:'retrieval-worker-2',operation:'read',args:{query:'Eligibility'}});
  checks.push({name:'title-only word cannot manufacture a body match',passed:ghost.ranges.length===0 && ghost.retrieval.total_matches===0 && ghost.coverage.partial===true,
    totalMatches:ghost.retrieval.total_matches});
  await transport({worker_id:'retrieval-worker-2',operation:'close'});
  const remaining = await worker.evaluate(async()=> (await chrome.tabs.query({})).map(tab=>tab.id));
  assert(!remaining.includes(tab));
  const hashes = {};
  for(const file of ['background.js','browser-content.js','evidence-search.js']) hashes[file]=createHash('sha256').update(await readFile(resolve(process.env.NUBI_EXTENSION_DIR || 'dist',file))).digest('hex');
  await mkdir(output,{recursive:true});
  await writeFile(resolve(output,'browser.json'),JSON.stringify({checks,requests,hashes,actualBrowser:true,actualModel:false,siteWrites:0,
    scope:'Local fixture, native Chrome isolated content reader, owned research tabs and DNR. Page mutation is a test setup operation, not an agent write. No model performance or production-site claim.'},null,2)+'\n');
  for(const check of checks)console.log(`${check.passed?'PASS':'FAIL'} ${check.name}`);
  assert(checks.every(check=>check.passed),'Retrieval regression checks failed; see preserved browser.json');
} finally {
  await context?.close(); server.closeAllConnections(); await new Promise(done=>server.close(done));
  await rm(profile,{recursive:true,force:true});
}
