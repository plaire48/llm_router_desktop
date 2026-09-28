// Typing "/" in the composer lists the registered templates, the way a command
// palette does. Choosing one only writes the command into the draft: nothing is
// opened or sent until the user sends the request.
import './ui-source-loader.mjs';
import test, {afterEach, after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html lang="ko"><head><title>Office source tests</title></head><body></body></html>',{url:'https://office.test',pretendToBeVisual:true});
for(const name of ['window','document','navigator','HTMLElement','Element','Node','MutationObserver','getComputedStyle','innerWidth','innerHeight'])Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]});
globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
dom.window.HTMLElement.prototype.scrollIntoView=function(){};
const React=await import('react');
const {render,screen,fireEvent,waitFor,cleanup}=await import('@testing-library/react');
const {default:axe}=await import('axe-core');
const {OfficeComposer}=await import('../src/OfficeComposer.jsx');
afterEach(cleanup);after(()=>dom.window.close());

const h=React.createElement,noop=()=>{};
const entry=(id,name,summary)=>({id:id.repeat(8)+'-'+id.repeat(4)+'-'+id.repeat(4)+'-'+id.repeat(4)+'-'+id.repeat(12),host:'excel',name,summary,revision:1,itemCount:1,inputCount:1,available:true});
const catalog=[entry('1','출장 신청서','임직원 국내외 출장 사전 신청'),entry('2','지출 결의서','부서 경비 지출 승인 요청'),entry('4','견적서','고객사 제출용 물품 견적'),entry('5','출장 정산서','출장 후 경비 정산')];
const data={activeProvider:'aipro',settings:{modelId:'fixture'},catalog:{models:[{name:'fixture',displayName:'Scripted model'}]},connections:{aipro:{present:true}},report:{}};
// The composer is controlled: the harness keeps the draft the way the app does.
function Harness({loadTemplates,onSend=noop,initial=''}){
  const [draft,setDraft]=React.useState(initial);
  return h(OfficeComposer,{data,draft,onDraft:setDraft,onSend,onStop:noop,onModels:noop,onLocate:noop,onTemplates:noop,loadTemplates});
}
const box=()=>screen.getByRole('textbox',{name:'Excel 작업 요청'});
const options=()=>screen.queryAllByRole('option').map(option=>option.textContent);

test('typing a slash lists the registered templates and narrows while typing',async()=>{
  let loads=0;const view=render(h(Harness,{loadTemplates:async()=>{loads++;return catalog;}}));
  assert.equal(screen.queryByRole('listbox'),null);
  fireEvent.change(box(),{target:{value:'/'}});
  await waitFor(()=>assert.equal(options().length,4));
  assert.ok(options()[0].includes('출장 신청서')&&options()[0].includes('임직원 국내외 출장 사전 신청'));
  assert.equal(screen.getByRole('listbox').getAttribute('aria-label'),'등록한 양식');
  assert.equal(box().getAttribute('aria-controls'),screen.getByRole('listbox').id);
  assert.equal(box().getAttribute('aria-activedescendant'),screen.getAllByRole('option')[0].id);
  assert.equal((await axe.run(view.container,{rules:{'color-contrast':{enabled:false}}})).violations.length,0);
  fireEvent.change(box(),{target:{value:'/출장'}});
  await waitFor(()=>assert.deepEqual(screen.getAllByRole('option').map(option=>option.querySelector('strong').textContent),['출장 신청서','출장 정산서']));
  assert.equal(loads,1,'the catalog is read once while one command is typed');
});
test('arrow keys move the choice and Enter writes the command without sending',async()=>{
  let sent=0;render(h(Harness,{loadTemplates:async()=>catalog,onSend:()=>{sent++;}}));
  fireEvent.change(box(),{target:{value:'/출장'}});
  await waitFor(()=>assert.equal(options().length,2));
  fireEvent.keyDown(box(),{key:'ArrowDown'});
  assert.equal(screen.getAllByRole('option')[1].getAttribute('aria-selected'),'true');
  fireEvent.keyDown(box(),{key:'ArrowDown'});
  assert.equal(screen.getAllByRole('option')[0].getAttribute('aria-selected'),'true','the choice wraps around');
  fireEvent.keyDown(box(),{key:'ArrowUp'});
  fireEvent.keyDown(box(),{key:'Enter'});
  assert.equal(box().value,'/출장정산서 ');assert.equal(sent,0);assert.equal(screen.queryByRole('listbox'),null);
  fireEvent.change(box(),{target:{value:'/출장정산서 부산 2박 3일'}});
  fireEvent.keyDown(box(),{key:'Enter'});
  assert.equal(sent,1,'once the request is written, Enter sends as before');
});
test('the option chosen with the keyboard is brought into view in a long list',async()=>{
  const shown=[],original=dom.window.HTMLElement.prototype.scrollIntoView;
  dom.window.HTMLElement.prototype.scrollIntoView=function(options){shown.push([this.id,options?.block]);};
  try{
    render(h(Harness,{loadTemplates:async()=>catalog}));
    fireEvent.change(box(),{target:{value:'/'}});await waitFor(()=>assert.equal(options().length,4));
    fireEvent.keyDown(box(),{key:'ArrowUp'});
    await waitFor(()=>assert.deepEqual(shown.at(-1),['template-suggestion-'+catalog[3].id,'nearest']));
  }finally{dom.window.HTMLElement.prototype.scrollIntoView=original;}
});
test('a suggestion can be chosen with the mouse, and Escape closes the list',async()=>{
  render(h(Harness,{loadTemplates:async()=>catalog}));
  fireEvent.change(box(),{target:{value:'/견'}});
  fireEvent.click(await screen.findByRole('option',{name:/견적서/}));
  assert.equal(box().value,'/견적서 ');
  fireEvent.change(box(),{target:{value:'/지출'}});
  await screen.findByRole('option',{name:/지출 결의서/});
  fireEvent.keyDown(box(),{key:'Escape'});
  assert.equal(screen.queryByRole('listbox'),null);assert.equal(box().value,'/지출');
});
test('a composing Korean character is never taken as Enter on a suggestion',async()=>{
  let sent=0;render(h(Harness,{loadTemplates:async()=>catalog,onSend:()=>{sent++;}}));
  fireEvent.change(box(),{target:{value:'/견'}});await screen.findByRole('option',{name:/견적서/});
  fireEvent.keyDown(box(),{key:'Enter',keyCode:229});
  assert.equal(box().value,'/견');assert.equal(sent,0);
});
test('no match, an unreadable catalog or ordinary text shows no list and keeps Enter for sending',async()=>{
  let sent=0,loads=0;const first=render(h(Harness,{loadTemplates:async()=>{loads++;throw new Error('template_catalog_unavailable');},onSend:()=>{sent++;}}));
  fireEvent.change(box(),{target:{value:'/견적서'}});
  await waitFor(()=>assert.equal(loads,1));
  assert.equal(screen.queryByRole('listbox'),null);
  fireEvent.keyDown(box(),{key:'Enter'});assert.equal(sent,1,'the worker still answers an unknown command');
  first.unmount();
  render(h(Harness,{loadTemplates:async()=>{loads++;return catalog;},onSend:()=>{sent++;}}));
  fireEvent.change(box(),{target:{value:'A2를 4로 바꿔줘'}});
  assert.equal(loads,1,'ordinary text never reads the catalog');assert.equal(screen.queryByRole('listbox'),null);
  fireEvent.change(box(),{target:{value:'/회의록'}});
  await waitFor(()=>assert.equal(loads,2));assert.equal(screen.queryByRole('listbox'),null);
});
test('without a catalog reader the composer behaves exactly as before',()=>{
  let sent=0;render(h(Harness,{onSend:()=>{sent++;}}));
  fireEvent.change(box(),{target:{value:'/견적서'}});
  assert.equal(screen.queryByRole('listbox'),null);assert.equal(box().getAttribute('aria-controls'),null);
  fireEvent.keyDown(box(),{key:'Enter'});assert.equal(sent,1);
});
