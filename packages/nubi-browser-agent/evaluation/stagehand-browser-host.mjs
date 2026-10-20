import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {Stagehand} from '@browserbasehq/stagehand';
import {createStagehandModelBridge} from '../dist/stagehand.js';

// Only the evaluation host launches a temporary Chrome. The module/SDK attach to that same owned browser.
export async function stagehandBrowserHost(model){
 const profile=await mkdtemp(join(tmpdir(),'nubi-stagehand-profile-'));let context,sdk;
 try{
  context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,locale:'ko-KR',viewport:{width:1280,height:900},args:['--remote-debugging-port=0']});
  const [port,endpoint]=String(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n');
  const page=context.pages()[0]??await context.newPage();
  const modelBridge=createStagehandModelBridge(model);
  sdk=new Stagehand({env:'LOCAL',llmClient:modelBridge.client,localBrowserLaunchOptions:{cdpUrl:'ws://127.0.0.1:'+port+endpoint},disableAPI:true,disablePino:true,verbose:0,logger:()=>{},logInferenceToFile:false,serverCache:false,selfHeal:false});
  await sdk.init();
  return {context,page,sdk,modelBridge,version:context.browser().version(),async close(){await sdk.close().catch(()=>{});await context.close().catch(()=>{});await rm(profile,{recursive:true,force:true});}};
 }catch(error){await sdk?.close().catch(()=>{});await context?.close().catch(()=>{});await rm(profile,{recursive:true,force:true});throw error;}
}
