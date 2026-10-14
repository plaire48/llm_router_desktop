import {installWorkspaceBrowser} from '../runtime/workspace-browser.mjs';
import {createInAppPlaywright} from '../runtime/playwright-mcp.mjs';
const service={};installWorkspaceBrowser(service);
let client=await createInAppPlaywright(service.playwrightRequest);
process.on('message',async message=>{if(!message?.testId)return;try{if(message.close){await client.close();process.send({testId:message.testId,result:true});return;}if(message.call?.name==='__reconnect'){await client.close();client=await createInAppPlaywright(service.playwrightRequest);process.send({testId:message.testId,result:true});return;}const result=message.call?.name==='__list'?await client.listTools():await client.callTool(message.call);process.send({testId:message.testId,result});}catch(error){process.send({testId:message.testId,error:error.message});}});
process.send({ready:true});
