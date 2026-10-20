// One saved or drafted browser card runs on the Workspace browser through the existing deterministic replay with
// no model (browser teach plan T6 and the T8 host connection, §8 답 32). The workflow adapter and the teach trial
// share this so a draft trial and a reviewed script run the same way: open the start page, snapshot, match, act,
// snapshot again after every action.
import {runWorkflow} from './browser-workflow.mjs';
import {fail} from './files.mjs';

const textOf=result=>typeof result?.text==='string'?result.text:(result?.content||[]).filter(part=>part.type==='text').map(part=>part.text).join('\n');

/** A fresh page reading bound to one tab and document; the document is checked before and after. */
export async function cardSnapshot(service,binding,{signal,alive=()=>{}}={}){
  signal?.throwIfAborted();alive();
  if(typeof service.playwrightRequest!=='function'||typeof service.mcpRegistry!=='function')fail('workflow_browser_unavailable');
  const before=await service.playwrightRequest('check',binding,{signal});
  if(before.tabId!==binding.tabId||before.documentId!==binding.documentId)fail('browser_document_changed');
  const result=await service.mcpRegistry().call('mcp__playwright__browser_snapshot',binding,{signal});
  if(result?.ok===false||result?.isError)fail('workflow_browser_snapshot');
  const after=await service.playwrightRequest('check',binding,{signal});
  if(after.tabId!==before.tabId||after.documentId!==before.documentId)fail('browser_document_changed');
  signal?.throwIfAborted();alive();
  const text=textOf(result);if(!text.includes('### Snapshot'))fail('workflow_browser_snapshot');
  const match=/^\s*- Page URL:\s*(\S+)\s*$/m.exec(text.split('### Snapshot')[0]);
  return {tabId:before.tabId,documentId:before.documentId,url:match?.[1]??null,text,truncated:/snapshot truncated|tokens truncated|자 생략/i.test(text)};
}

/** Runs card.steps with the given slot values. Returns typed facts only; the caller writes receipts. */
export async function runBrowserCard(service,{card,values,signal,alive=()=>{}}){
  if(typeof card?.startPage!=='string'||!/^https?:\/\//.test(card.startPage))fail('browser_script_start_missing');
  if(typeof service.playwrightRequest!=='function'||typeof service.mcpRegistry!=='function')fail('workflow_browser_unavailable');
  const started=Date.now(),binding=await service.playwrightRequest('open',{url:card.startPage},{signal});
  if(!binding?.tabId||!binding.documentId||binding.automation===false)fail('workflow_browser_unavailable');
  let current={tabId:binding.tabId,documentId:binding.documentId};
  const result=await runWorkflow({steps:card.steps,values},{signal,
    observe:async()=>(await cardSnapshot(service,current,{signal,alive})).text,
    act:async(tool,input)=>{
      signal?.throwIfAborted();alive();
      const outcome=await service.mcpRegistry().call('mcp__playwright__'+tool,{...current,...input},{signal});
      if(outcome?.isError||outcome?.ok===false)return {ok:false,execution:'failed'};
      const after=await service.playwrightRequest('check',{tabId:current.tabId},{signal});current={tabId:after.tabId,documentId:after.documentId};
      // The page is read again after every action so the next step matches the page as it is now.
      return {ok:true,text:(await cardSnapshot(service,current,{signal,alive})).text};
    }});
  return {completed:!!result.completed,confirmedSteps:result.confirmedSteps,stopped:result.stopped?.text??result.stopped?.reason??null,ms:Date.now()-started,tabId:current.tabId,documentId:current.documentId};
}
