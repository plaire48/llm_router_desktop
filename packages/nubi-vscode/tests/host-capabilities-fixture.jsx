window.__nubiExternalFixture=true;
window.unsupportedCalls=[];
const {fixtureApi,fixtureProject}=await import('../../nubi-desktop/tests/shared-ui-fixture.jsx');
const first=fixtureProject.tasks[0];first.messages[0].runId='vscode-run';first.sideTasks=[{id:'side',runId:'vscode-run',state:'proposed',title:'별도 조사',tldr:'추가 확인',prompt:'src/app.mjs 확인'}];
const unsupported=new Set(['exportConversation','taskUsage','markTaskRead','setPinnedTasks','archiveTask','setAutoArchiveDays','setAfterEditCheck','retryAfterEditCheck','startSideTask','dismissSideTask','conversationHistory','listRoutines']);
window.acquireVsCodeApi=()=>({postMessage:async({id,method,args=[]})=>{
 try{let result;
  if(method==='api'){if(unsupported.has(args[0])){window.unsupportedCalls.push(args[0]);throw Error('method_invalid');}result=await fixtureApi(...args);}
  else if(method==='openCurrent')result=fixtureProject;
  else if(method==='ghesAccount')result={state:'guest',connected:false,profile:null};
  else if(method==='ghesUpdate')result={state:'unchecked'};
  else result=null;
  window.dispatchEvent(new MessageEvent('message',{data:{id,result}}));
 }catch(error){window.dispatchEvent(new MessageEvent('message',{data:{id,error:error.message}}));}
}});
await import('../src/webview.jsx');
