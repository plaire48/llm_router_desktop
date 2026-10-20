// A person's demonstration becomes a procedure card (browser teach plan T3, 2026-10-21). A page-side listener
// reports clicks, typed values, dropdown choices and a few keys; the host turns each report into the same
// replay step a learned run produces, through the injected recorder (recordStep, recordTarget) that the
// existing deterministic engine owns. Values never enter the card: each typed or chosen value becomes an
// input slot. Password and one-time-code fields and protected pages are never recorded.
import type {Page,Frame} from 'playwright-core';
import type {Json,JsonObject} from './types.js';
import {createHash} from 'node:crypto';

export interface DemonstrationEvent {kind:'click'|'input'|'select'|'key';at:number;index:number;key?:string;value?:string;values?:string[];items:JsonObject[];url:string;title:string}
export interface DemonstrationRecorder {recordStep(tool:string,args:JsonObject,observation:JsonObject,result:JsonObject,slot:()=>string):{step?:JsonObject;unreplayable?:string;values?:JsonObject}|null;recordTarget(element:JsonObject,view:JsonObject):JsonObject|null}
export interface DemonstrationCard {schemaVersion:1;id:string;version:number;status:'draft';title:string;wikiRef:{id:string;version:number;hash:string};startPage?:string;inputs:{slot:string;label:string;kind?:string}[];steps:JsonObject[];demonstration:{events:number;skipped:number}}

export const INTERACTIVE_SELECTOR='input:not([type="hidden"]),textarea,button,select,a[href],[contenteditable="true"],[onclick],[tabindex]';
const KEYS=new Set(['Tab','Enter','Escape','ArrowDown','ArrowUp','Space','Backspace']);
const sensitiveKinds=['password','hidden'];

// Runs inside the page. It lists every interactive control of the document with the same fields the structural
// observation uses, so a demonstrated target carries the same identity as an observed one.
export const DEMONSTRATION_SCRIPT=`(() => {
  const SELECTOR=${JSON.stringify(INTERACTIVE_SELECTOR)};
  const label=e=>{const id=e.getAttribute('id');const forLabel=id?document.querySelector('label[for="'+id.replace(/"/g,'')+'"]'):null;return (forLabel?.textContent??e.closest('label')?.textContent??'').trim();};
  const info=e=>({tag:e.tagName.toLowerCase(),type:e instanceof HTMLInputElement?e.type:'',role:e.getAttribute('role')??'',name:(e.getAttribute('aria-label')??e.getAttribute('title')??(e instanceof HTMLInputElement&&['button','submit','reset'].includes(e.type)?e.value:(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement||e instanceof HTMLSelectElement)?(label(e)||e.getAttribute('placeholder')||''):e.textContent)??'').trim().slice(0,120),context:(e.closest('tr')?.innerText??e.parentElement?.innerText??'').trim().slice(0,240),editable:e instanceof HTMLTextAreaElement||e instanceof HTMLInputElement||e.isContentEditable,disabled:e.disabled===true,readOnly:e.readOnly===true,sensitive:e instanceof HTMLInputElement&&(['password','hidden'].includes(e.type)||/one-time-code|password/.test(e.autocomplete||''))});
  const snapshot=target=>{const all=Array.from(document.querySelectorAll(SELECTOR)).slice(0,400);return {index:all.indexOf(target),items:all.map(info),url:location.href,title:document.title};};
  const control=node=>node instanceof Element?node.closest(SELECTOR):null;
  const send=(kind,extra)=>{try{window.__nubiDemonstration(JSON.stringify({kind,at:Date.now(),...extra}));}catch{}};
  document.addEventListener('click',event=>{const el=control(event.target);if(!el)return;if(el instanceof HTMLInputElement&&!['button','submit','reset','checkbox','radio'].includes(el.type))return;send('click',snapshot(el));},true);
  document.addEventListener('change',event=>{const el=control(event.target);if(!el)return;if(el instanceof HTMLSelectElement){send('select',{...snapshot(el),values:Array.from(el.selectedOptions).map(o=>o.value)});return;}if(el instanceof HTMLInputElement&&['checkbox','radio'].includes(el.type))return;if((el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement)&&!info(el).sensitive)send('input',{...snapshot(el),value:el.value});},true);
  document.addEventListener('keydown',event=>{if(!['Tab','Enter','Escape','ArrowDown','ArrowUp','Backspace'].includes(event.key)&&event.key!==' ')return;const el=control(event.target);if(!el)return;send('key',{...snapshot(el),key:event.key===' '?'Space':event.key});},true);
})();`;

export interface DemonstrationOptions {page:Page;recorder:DemonstrationRecorder;allowUrl?(url:string):boolean;frameRoute?(frame:Frame):string}
/** Attaches the listener to a Playwright page the host owns; nothing is recorded until start(). */
export async function createDemonstration(options:DemonstrationOptions){
  const {page,recorder}=options;const events:DemonstrationEvent[]=[];let active=false;
  const route=options.frameRoute??(frame=>{try{const u=new URL(frame.url());return u.origin+u.pathname;}catch{return 'about:blank';}});
  await page.exposeBinding('__nubiDemonstration',async({frame},payload:string)=>{
    if(!active)return;
    let event:DemonstrationEvent;try{event=JSON.parse(payload);}catch{return;}
    if(options.allowUrl&&!options.allowUrl(event.url))return;
    if(frame!==page.mainFrame())return;// Demonstrations inside child frames are a later step; the main frame only.
    events.push(event);
  });
  await page.addInitScript(DEMONSTRATION_SCRIPT);
  await page.evaluate(DEMONSTRATION_SCRIPT).catch(()=>{});
  return {
    start(){active=true;},
    stop(){active=false;return events.slice();},
    get events(){return events.slice();},
    card(input:{id:string;title:string;wikiRef:{id:string;version:number}}):DemonstrationCard|null{return demonstrationCard(events,{...input,recorder,route:route(page.mainFrame())});},
  };
}

const elementOf=(item:JsonObject,ref:string):JsonObject=>({ref,tag:item.tag??'',role:(item.role as string)||(item.tag==='input'&&item.type==='checkbox'?'checkbox':item.tag==='input'&&item.type==='radio'?'radio':item.tag==='input'||item.tag==='textarea'||item.editable?'textbox':item.tag==='button'?'button':item.tag==='a'?'link':item.tag==='select'?'combobox':'generic'),name:item.name??'',kind:item.editable?'field':'control',...(item.type?{type:item.type}:{}),context:item.context?[{role:'group',name:item.context}]:[],...(item.disabled||item.readOnly?{coveredBy:'disabled'}:{})});

/** Turns recorded events into a draft card. Typed and chosen values become slots; the card keeps no value. */
export function demonstrationCard(events:DemonstrationEvent[],input:{id:string;title:string;wikiRef:{id:string;version:number};recorder:DemonstrationRecorder;route:string}):DemonstrationCard|null{
  const steps:JsonObject[]=[],inputs:DemonstrationCard['inputs']=[];let serial=0,skipped=0;const slot=()=>`v${++serial}`;
  // Repeated typing into the same field keeps only the last value (a person corrects while typing).
  const merged:DemonstrationEvent[]=[];
  for(const event of events){const last=merged.at(-1);if(event.kind==='input'&&last?.kind==='input'&&last.index===event.index&&last.url===event.url)merged[merged.length-1]=event;else merged.push(event);}
  for(const event of merged){
    const target=event.items[event.index];if(!target||event.index<0||(target as JsonObject).sensitive===true){skipped++;continue;}
    if(event.kind==='key'&&!KEYS.has(event.key??'')){skipped++;continue;}
    const ref='demo-ref';
    const elements=event.items.map((item,k)=>elementOf(item as JsonObject,k===event.index?ref:'sibling-'+k));
    const view:JsonObject={url:event.url,title:event.title,frames:[{frame:0,url:input.route,elements}]};
    const tool=event.kind==='input'?'fill_form':event.kind==='select'?'select_option':event.kind==='key'?'press_key':'click_element';
    const args:JsonObject=event.kind==='input'?{fields:[{field_id:ref,value:event.value??''}]}:event.kind==='select'?{ref,values:event.values??[]}:event.kind==='key'?{ref,key:event.key??''}:{ref};
    // The recorder reads the page after the action from result.observation (a link click records where it went).
    const captured=input.recorder.recordStep(tool,args,view,{actionIssued:true,observation:{url:event.url,title:event.title}},slot);
    if(!captured?.step||captured.unreplayable){skipped++;continue;}
    const recorded=input.recorder.recordTarget(elements[event.index]!,view);if(!recorded){skipped++;continue;}
    const step=captured.step as JsonObject;
    if(step.target)step.target=recorded;for(const field of (step.fields as JsonObject[]|undefined)??[])field.target=recorded;
    delete step.formContract;delete step.formTitle;
    if(tool==='fill_form')inputs.push({slot:(step.fields as JsonObject[])[0]!.slot as string,label:(recorded.name as string)||(recorded.context as JsonObject[]|undefined)?.[0]?.name as string||'입력값'});
    if(tool==='select_option')inputs.push({slot:step.slot as string,label:(recorded.name as string)||'선택값',kind:'choice'});
    steps.push(step);
  }
  if(!steps.length)return null;
  const hash=createHash('sha256').update(JSON.stringify(steps)).digest('hex');
  // Where the demonstration began: a saved script opens this page before its first step (origin and path only).
  const first=events.find(e=>e.url);let startPage:string|undefined;try{if(first){const u=new URL(first.url);startPage=u.origin+u.pathname;}}catch{startPage=undefined;}
  return {schemaVersion:1,id:input.id,version:1,status:'draft',title:input.title,wikiRef:{...input.wikiRef,hash},...(startPage?{startPage}:{}),inputs,steps,demonstration:{events:events.length,skipped}};
}
export const demonstrationValues=(events:DemonstrationEvent[]):Json[]=>events.filter(e=>e.kind==='input'||e.kind==='select').map(e=>e.kind==='input'?e.value??'':(e.values??[]).join(','));
