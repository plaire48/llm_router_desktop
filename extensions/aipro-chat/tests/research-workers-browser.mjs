import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,cp,readFile,writeFile,appendFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createResearchWorkers} from '../research-workers.js';
import {runAgent} from '../agent-runtime.js';

const checks=[],requests=[];
const server=createServer((req,res)=>{
  requests.push(req.url);
  if(req.url==='/redirect'){res.writeHead(302,{Location:'/destination'});res.end();return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(req.url==='/sign-in-reference'){res.end('<title>Account</title><input type="password">');return;}
  const subject=req.url.startsWith('/b')?'B':'A';
  const detail=req.url.endsWith('/details');
  res.end(`<title>Library ${subject}</title><main><h1>Library ${subject}</h1><p>${detail?'During October 2026, entry is members only.':'The library is open on weekdays.'}</p><p>${'Reference information about library hours and eligibility. '.repeat(12)}</p></main>${detail?'':`<a href="/${subject.toLowerCase()}/details">October exception</a>`}`);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(resolve(tmpdir(),'nubi-independent-research-')),extension=resolve(profile,'extension');
let context;
try {
  await cp(resolve('dist'),extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  // Isolated fixture owner injection: this checks the actual Chrome transport,
  // DNR and content reader, not production chat authentication or a real LLM.
  await appendFile(resolve(extension,'background.js'),`\nglobalThis.researchProbe={ready:serial(()=>Promise.resolve()),host:nativeResearchBrowser({checkOwner:async owner=>{if(owner!=='fixture-owner')throw Error('interrupted');}})};\n`);
  context=await chromium.launchPersistentContext(profile,{headless:true,...(process.env.CHROME_BINARY?{executablePath:process.env.CHROME_BINARY}:{channel:'chromium'}),args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const personal=await context.newPage();await personal.goto(`${origin}/personal`);
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{await researchProbe.ready;});
  const initialTabs=await worker.evaluate(async()=> (await chrome.tabs.query({})).map(tab=>tab.id));
  const transport=(operation,owner='fixture-owner')=>worker.evaluate(async({operation,owner})=>researchProbe.host.execute(owner,operation),{operation,owner});
  const evidence=[],events=[],receipts=[];let maximumTabs=0;
  const signal=new AbortController();
  const researchers=createResearchWorkers({browser:async operation=>{
    const result=await transport(operation);
    maximumTabs=Math.max(maximumTabs,await worker.evaluate(async()=> (await chrome.tabs.query({})).length));
    return result;
  },run:runAgent,signal:signal.signal,goal:'Compare both libraries for October 2026. Exclude members-only entry.',onEvidence:(_name,_args,result)=>evidence.push(result),onDelivery:receipt=>receipts.push(receipt),onStep:event=>events.push(event),complete:async(messages,tools)=>{
    assert.deepEqual(tools.map(tool=>tool.function.name),['read_research_page','follow_research_link','submit_research']);
    const assignment=JSON.parse(messages[1].content);
    assert(assignment.original_goal.includes('Exclude members-only'));
    const call=(name,args)=>({calls:[{id:crypto.randomUUID(),function:{name,arguments:JSON.stringify(args)}}]});
    const resultMessages=messages.filter(message=>message.role==='tool');
    if(!resultMessages.length)return call('follow_research_link',{link_id:assignment.source.research_links[0].id});
    if(resultMessages.length===1){
      const packet=JSON.parse(resultMessages[0].content),source=typeof packet.text==='string'?JSON.parse(packet.text).result:packet;
      assert(source.ranges.some(range=>range.markdown.includes('members only')));
      return call('submit_research',{findings:[{name:'hours',value:'Weekdays',reference_id:assignment.source.reference_id,quote:'The library is open on weekdays.'},{name:'exception',value:'October 2026 is members only',reference_id:source.reference_id,quote:'During October 2026, entry is members only.'}],gaps:[]});
    }
    return {content:'Quoted rule and exception delivered.'};
  }});
  try {
    const result=await researchers.execute({tasks:['A','B'].map(subject=>({subject,question:'Find hours and October entry exception',fields:['hours','exception'],start_url:`${origin}/${subject.toLowerCase()}`,constraints:'Exclude members-only entry. Keep the date and exception with the rule.'}))});
    assert.equal(result.research.length,2);
    assert(result.research.every(report=>report.status==='reported'&&report.fields.length===2&&report.fields.every(field=>field.quote_checked&&!field.interpretation_verified)));
    assert.equal(evidence.length,4);assert(maximumTabs>=initialTabs.length+2);
    assert.equal(receipts.length,2);assert(receipts.every(receipt=>receipt.reads===2&&receipt.calls===3&&receipt.delivered&&receipt.cleanup==='confirmed'&&receipt.source_reads.length===2));
    assert.equal(events.filter(event=>event.status==='done').length,2);
    checks.push('real Pi children concurrently navigate separate Chrome tabs and return exact rule/October exception quotes to the leader');
  } finally {researchers.close();}
  assert.deepEqual(await worker.evaluate(async()=> (await chrome.tabs.query({})).map(tab=>tab.id)),initialTabs);
  assert.deepEqual(await worker.evaluate(async()=> (await chrome.storage.session.get('researchTabs')).researchTabs),[]);
  assert.equal(await worker.evaluate(async()=> (await chrome.declarativeNetRequest.getSessionRules()).filter(rule=>rule.id>=720000&&rule.id<720008).length),0);
  checks.push('confirmed cleanup removes only owned tabs, fences and records; original tabs remain');
  await assert.rejects(transport({worker_id:'research-no-access',operation:'open',url:'https://ungranted.example.test/reference'}),/page_access_required/);
  await assert.rejects(transport({worker_id:'research-forbidden',operation:'open',url:origin+'/%6Cogout'}),/page_restricted/);
  assert.deepEqual(await worker.evaluate(async()=> (await chrome.tabs.query({})).map(tab=>tab.id)),initialTabs);
  checks.push('missing existing origin permission and encoded action endpoints are rejected before creating tabs');
  await assert.rejects(transport({worker_id:'research-redirect',operation:'open',url:origin+'/redirect'}));
  assert(!requests.includes('/destination'));
  await transport({worker_id:'research-redirect',operation:'close'});
  const login=await transport({worker_id:'research-account',operation:'open',url:origin+'/sign-in-reference'});
  assert.equal(login.error,'research_login_required');
  await assert.rejects(transport({worker_id:'research-account',operation:'read'},'foreign-owner'),/interrupted/);
  await assert.rejects(transport({worker_id:'research-account',operation:'follow',args:{link_id:'forged'}}),/browser_stale/);
  await worker.evaluate(()=>researchProbe.host.recover());
  assert.deepEqual(await worker.evaluate(async()=> (await chrome.tabs.query({})).map(tab=>tab.id)),initialTabs);
  checks.push('exact destination DNR blocks unobserved redirects; login, foreign owners and forged links do not expand scope; restart cleanup never restarts work');
  const output=process.env.NUBI_VERIFICATION_DIR||'verification/research-workers';await mkdir(output,{recursive:true});
  await writeFile(resolve(output,'browser.json'),JSON.stringify({checks,requests,maximumTabs,receipts,actualBrowser:true,actualModel:false,syntheticSite:true,fixtureOwnerInjected:true,independentFinalAnswerAccuracy:'not_measured'},null,2));
  console.log(checks.join('\n'));
} finally {await context?.close();await new Promise(done=>server.close(done));await rm(profile,{recursive:true,force:true});}
