// The chat forwards the catalog listing and the copy request of a run to the
// native host and keeps the opened copy bound to the conversation, so the next
// message continues in the same form. The worker and the host are scripted.
import './ui-source-loader.mjs';
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html lang="ko"><head><title>Office source tests</title></head><body></body></html>',{url:'https://office.test',pretendToBeVisual:true});
for(const name of ['window','document','navigator','HTMLElement','Element','Node','MutationObserver','getComputedStyle','innerWidth','innerHeight'])Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]});
globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
dom.window.HTMLElement.prototype.scrollIntoView=function(){};
globalThis.IntersectionObserver=class{observe(){}disconnect(){}};
const React=await import('react');
const {render,screen,fireEvent,waitFor,cleanup}=await import('@testing-library/react');
after(()=>{cleanup();dom.window.close();});

const templateId='11111111-2222-3333-4444-555555555555';
const session={connected:true,provider:'aipro',model:'fixture-qwen',models:[{id:'fixture-qwen',label:'Scripted model'}],providers:[{id:'aipro',connected:true},{id:'chatgpt',connected:false},{id:'fabrix',connected:false},{id:'aipro-cli',connected:false},{id:'compatible',connected:false}]};
const grid=value=>[[value]];
const sheet=(scopeId,documentId,worksheet,address)=>({scopeId,documentId,worksheet,address,values:grid(''),displayTexts:grid(''),formulas:grid(''),formats:{},properties:{}});
const blank=sheet('blank-scope','blank-book','Sheet1','A1'),copy=sheet('copy-scope','copy-book','견적서','A1');
const record={id:templateId,name:'견적서',profile:{worksheet:'견적서',address:'A1',fields:[]}};
const preservation={schemaVersion:1,stage:'opened_copy',target:'견적서!A1',status:'partial',checks:[],differences:[],differenceCount:0,expectedValueChanges:0,note:''};
const opened={record,documentId:copy.documentId,worksheet:copy.worksheet,address:copy.address,entry:{id:templateId,name:'견적서'},preservation};

test('a template called from the chat is opened by the host and stays bound to the conversation',async()=>{
  let receive,copied=false,polls=0;const starts=[],hostCalls=[],results=[],typed=[];
  const status=()=>{
    const base={id:'invoke-run',state:'running',phase:'routing',metrics:{},activity:[]};
    if(starts.length===2)return{...base,state:'done',answer:'공급가액을 고쳤습니다.',writes:1,action:null};
    if(!results.length)return{...base,action:{callId:'list-call',name:'template_catalog_list',payload:{}}};
    if(results.length===1)return{...base,phase:'opening_template',action:{callId:'use-call',name:'template_catalog_use',payload:{templateId}}};
    // One poll shows the copy while the run is still working, the next one ends it.
    return polls++?{...base,state:'done',answer:'견적서를 작성했습니다.',writes:1,executionMode:'template',templateCopy:opened,preservation,action:null}:{...base,phase:'planning',executionMode:'template',templateCopy:opened,preservation,action:null};
  };
  globalThis.chrome={webview:{addEventListener:(_type,fn)=>{receive=fn;},postMessage:async({id,method,payload})=>{
    try{
      let result;
      if(method==='session')result=session;
      else if(method==='selection')result=copied?copy:blank;
      else if(method==='history')result=[];
      else if(method==='runStart'){starts.push(payload);result=status();}
      else if(method==='runStatus')result=status();
      else if(method==='toolResult'){results.push(payload);result={accepted:true};}
      else if(method==='template_catalog_list'){(starts.length?hostCalls:typed).push({method,payload});result={host:'excel',entries:[{id:templateId,host:'excel',revision:1,name:'견적서',summary:'거래처에 보내는 견적',itemCount:21,inputCount:21,available:true}],unreadable:0};}
      else if(method==='template_catalog_use'){hostCalls.push({method,payload});copied=true;result={copied:true,entry:{id:templateId,host:'excel',name:'견적서'},record,scope:copy,comparison:{before:copy,after:copy}};}
      else if(method==='runCancel')result={id:'invoke-run',state:'cancelled',action:null};
      else throw new Error('unexpected_test_method');
      receive({data:{id,ok:true,result}});
    }catch(cause){receive({data:{id,ok:false,error:cause.message}});}
  }}};
  const {default:App}=await import('../src/App.jsx');
  render(React.createElement(App));
  const request=await screen.findByRole('textbox',{name:'Excel 작업 요청'});
  // Typing the command lists the registered templates; choosing one only writes the draft.
  fireEvent.change(request,{target:{value:'/견'}});
  fireEvent.click(await screen.findByRole('option',{name:/견적서/}));
  await waitFor(()=>assert.equal(request.value,'/견적서 '));assert.equal(typed.length,1);assert.equal(starts.length,0);
  fireEvent.change(request,{target:{value:'/견적서 대한상사 앞으로 작성해줘'}});
  fireEvent.click(screen.getByRole('button',{name:'전송'}));
  await screen.findByText('견적서를 작성했습니다.',undefined,{timeout:5000});

  assert.equal(starts[0].templateCatalog,true,'the run may look up registered templates');
  assert.equal(starts[0].scope.scopeId,blank.scopeId);assert.equal(starts[0].templateRecord,undefined);
  assert.deepEqual(hostCalls.map(call=>call.method),['template_catalog_list','template_catalog_use']);
  assert.equal(hostCalls[1].payload.templateId,templateId);assert.equal(hostCalls[1].payload.operationId,'use-call','a copy is never requested twice for one call');
  assert.deepEqual(results.map(result=>result.callId),['list-call','use-call']);
  assert.equal(results[0].result.entries[0].name,'견적서');assert.equal(results[1].result.copied,true);
  await waitFor(()=>assert.ok(document.querySelector('.office-template-chip')?.textContent.includes('견적서'),'the composer shows which form the chat is bound to'));
  assert.equal(screen.getAllByText('견적서!A1').length>0,true,'the comparison of the opened copy is shown');

  await waitFor(()=>assert.equal(request.disabled,false));
  fireEvent.change(request,{target:{value:'공급가액을 60만원으로 고쳐줘'}});
  fireEvent.click(screen.getByRole('button',{name:'전송'}));
  await screen.findByText('공급가액을 고쳤습니다.',undefined,{timeout:5000});
  assert.equal(starts.length,2);assert.equal(starts[1].templateCatalog,undefined,'a bound conversation does not open another template');
  assert.equal(starts[1].templateRecord.id,templateId);
  assert.deepEqual(starts[1].templateBinding,{documentId:copy.documentId,worksheet:copy.worksheet,address:copy.address});
  assert.equal(hostCalls.length,2);
  fireEvent.change(request,{target:{value:'/견'}});
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(screen.queryByRole('listbox'),null,'a conversation bound to a form offers no other form');assert.equal(typed.length,1);
});
