import './ui-source-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {createProviders} from '../worker/providers.mjs';
import {fetchModelCatalog} from '../worker/aipro-auth.mjs';

// Saved response fixture, not a live service or model-quality measurement.
test('actual Office catalog shows every AI Pro model and sends every selected original ID',async()=>{
  const dom=new JSDOM('<!doctype html><html lang="ko"><body></body></html>',{url:'https://office.test',pretendToBeVisual:true});
  for(const name of ['window','document','navigator','HTMLElement','Element','Node','MutationObserver','getComputedStyle','innerWidth','innerHeight'])Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]});
  globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  dom.window.HTMLElement.prototype.scrollIntoView=function(){};
  dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  const React=await import('react'),{render,screen,fireEvent,waitFor,cleanup}=await import('@testing-library/react');
  const {ModelSelection}=await import('../../../extensions/aipro-chat/src/ChatControls.jsx');
  const fixture=JSON.parse(await readFile(new URL('../../../extensions/aipro-chat/tests/fixtures/aipro-models.json',import.meta.url),'utf8'));
  const token='eyJhbGciOiJSUzI1NiJ9.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+300})).toString('base64url')+'.signature';
  const sent=[];
  const fetchImpl=async(url,options)=>{
    assert.equal(options.headers.Authorization,`Bearer ${token}`);
    if(url.endsWith('/api/models')){assert.equal(options.cache,'no-store');return Response.json(fixture);}
    assert.equal(url,'https://aipro.sdsdev.co.kr/api/v1/chat/completions');
    sent.push(JSON.parse(options.body).model);
    return Response.json({choices:[{message:{content:'fixture acknowledgement'},finish_reason:'stop'}]});
  };
  const provider=createProviders({fetchImpl,startLogin:async()=>({result:fetchModelCatalog(token,fetchImpl).then(catalog=>({token,...catalog})),cancel(){}})});
  try{
    await provider.login('aipro');for(let i=0;i<50&&provider.status().pending;i++)await new Promise(resolve=>setImmediate(resolve));
    const state=provider.status();assert.equal(state.models.length,fixture.modelList.length);
    const props={data:{activeProvider:'aipro',settings:{modelId:state.model},catalog:{models:state.models.map(m=>({...m,name:m.id,displayName:m.label}))},connections:{aipro:{present:true}},report:{}},providerLabels:{aipro:'AI Pro',chatgpt:'ChatGPT',fabrix:'FabriX'},onRefresh:async()=>true,onClose(){},async onSelect(name){provider.model(name);await provider.complete([],[],new AbortController().signal,()=>{},()=>{});return true;}};
    render(React.createElement(ModelSelection,props));
    await waitFor(()=>assert.equal(document.querySelectorAll('.model-option').length,fixture.modelList.length));
    assert.deepEqual([...document.querySelectorAll('.model-option')].map(e=>e.getAttribute('aria-label')),fixture.modelList.map(m=>m.display_name||m.name));
    const search=screen.getByRole('textbox',{name:'모델 검색'});
    fireEvent.change(search,{target:{value:'aipro-fast-model'}});
    assert.equal(document.querySelectorAll('.model-option').length,1);
    assert.ok(screen.getByRole('button',{name:'aipro-fast-model',exact:true}));
    fireEvent.change(search,{target:{value:''}});
    for(const [i,model] of fixture.modelList.entries()){
      const row=screen.getByRole('button',{name:model.display_name||model.name,exact:true});
      await waitFor(()=>assert.equal(row.disabled,false));fireEvent.click(row);
      await waitFor(()=>assert.equal(sent.length,i+1));
      assert.equal(sent[i],model.name);
    }
    await waitFor(()=>assert.ok([...document.querySelectorAll('.model-option')].every(row=>!row.disabled)));
    assert.equal(provider.status().model,fixture.modelList.at(-1).name);
  }finally{cleanup();provider.dispose();dom.window.close();}
});
