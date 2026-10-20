import type {Frame,Locator,Page} from 'playwright-core';
import type {ScreenEvidence,ScreenFact,ScreenSource} from './knowledge.js';
import {fail} from './contracts.js';

/** Optional, read-only structural acquisition. Same host Page, no navigation or current input values. */
export function createPlaywrightScreenSource(options:{
  page:Page;screenId:string;variantId:string;
  access(signal:AbortSignal):Promise<boolean>;
  roots():readonly {frame:Frame;root:Locator}[];
  /** Disable query/record-specific document titles when the host provides a structural region title. */
  includeDocumentTitle?:boolean;
}):ScreenSource {
  const page=options.page;
  const read=async(signal:AbortSignal):Promise<ScreenEvidence>=>{
    signal.throwIfAborted();if(page.isClosed()||!await options.access(signal))fail('screen_access_denied');
    const roots=options.roots();if(!roots.length||roots.length>16)fail('screen_roots_invalid');
    const documents=new Map<Frame,string>();
    const startURL=page.url(),mainGeneration=String(await page.mainFrame().evaluate(()=>performance.timeOrigin));
    const facts:ScreenFact[]=[],identity:string[]=[];let partial=false;
    for(const [index,item] of roots.entries()){
      if(item.frame.page()!==page||item.frame.isDetached()||await item.root.count()!==1)fail('screen_roots_invalid');
      const handle=await item.root.elementHandle();if(!handle)fail('screen_roots_invalid');
      try{
        if(await handle.ownerFrame()!==item.frame)fail('screen_roots_invalid');
        const data=await handle.evaluate(root=>{
          const shown=(e:Element)=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return !!r.width&&!!r.height&&s.visibility!=='hidden'&&s.display!=='none';};
          const clean=(s:string)=>s.replace(/\s+/g,' ').trim().slice(0,240);
          const staticText=(e:Element|null)=>{if(!e)return '';const copy=e.cloneNode(true) as Element;copy.querySelectorAll('input,textarea,select,button,[contenteditable],script,style,[hidden],[aria-hidden=true]').forEach(x=>x.remove());return clean(copy.textContent??'');};
          const elements=[root,...Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading],form,table,section[aria-label],input,textarea,select,button,a[href],[role=button],[onclick],[tabindex],[contenteditable=true]'))];
          const rows=[];let omitted=false;
          for(const el of elements){
            if(!shown(el))continue;
            const field=el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement||el instanceof HTMLSelectElement||el instanceof HTMLElement&&el.isContentEditable;
            if(el instanceof HTMLInputElement&&(['hidden','password'].includes(el.type)||/password|one-time-code|^cc-/.test(el.autocomplete)||/token|secret|api.?key|password|otp/i.test(el.name)))continue;
            const heading=/^H[1-6]$/.test(el.tagName)||el.getAttribute('role')==='heading';
            const region=['FORM','TABLE','SECTION'].includes(el.tagName);
            const action=['BUTTON','A'].includes(el.tagName)||el.getAttribute('role')==='button'||!field&&(el.hasAttribute('onclick')||el.hasAttribute('tabindex'))||el instanceof HTMLInputElement&&['button','submit','reset'].includes(el.type);
            if(!field&&!heading&&!region&&!action)continue;
            const labels='labels' in el?Array.from((el as HTMLInputElement).labels??[]).map(label=>staticText(label)).join(' '):'';
            const context=staticText(el.closest('tr')??el.closest('label'));
            const text=clean(el.getAttribute('aria-label')||el.getAttribute('title')||labels||(heading||action?el.textContent??'':region?el.querySelector('legend,caption,h1,h2,h3')?.textContent??'':context)||el.getAttribute('name')||el.getAttribute('placeholder')||el.tagName.toLowerCase());
            rows.push({kind:heading?'heading':region?'region':action?'action':'field',text,context,tag:el.tagName,type:el.getAttribute('type'),role:el.getAttribute('role')});
            if(rows.length===128){omitted=true;break;}
          }
          return {rows,omitted,origin:performance.timeOrigin};
        });
        if(documents.has(item.frame)&&documents.get(item.frame)!==String(data.origin))documents.delete(item.frame);
        documents.set(item.frame,String(data.origin));identity.push(index+':'+data.origin);
        partial ||= data.omitted;
        for(const row of data.rows){if(facts.length===128){partial=true;break;}facts.push({id:'f'+facts.length,kind:row.kind as ScreenFact['kind'],text:row.text,context:row.context});}
      }finally{await handle.dispose();}
    }
    if(options.includeDocumentTitle!==false&&!facts.some(f=>f.kind==='heading')&&facts.length<128){const title=(await page.title()).replace(/\s+/g,' ').trim().slice(0,240);if(title)facts.push({id:'f'+facts.length,kind:'heading',text:title,context:'document title'});}
    if(!facts.length)fail('screen_evidence_empty');
    if(page.url()!==startURL||String(await page.mainFrame().evaluate(()=>performance.timeOrigin))!==mainGeneration||!await options.access(signal))fail('screen_changed');signal.throwIfAborted();
    // Stable structural semantics only. Document generations stay transient, not in persisted fingerprints.
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(facts)));
    const fingerprint='sha256:'+[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
    partial ||= page.frames().some(frame=>!roots.some(x=>x.frame===frame));
    const result={screenId:options.screenId,variantId:options.variantId,fingerprint,observedAt:new Date().toISOString(),facts,coverage:{partial,frames:new Set(roots.map(x=>x.frame)).size}};
    observations.set(result,{url:startURL,main:mainGeneration,frames:roots.map(x=>[x.frame,documents.get(x.frame)!] as const)});return result;
  };
  const observations=new WeakMap<ScreenEvidence,{url:string;main:string;frames:readonly (readonly [Frame,string])[]}>();
  return {observe:read,async validate(e,signal){
    const proof=observations.get(e);if(!proof||page.isClosed()||page.url()!==proof.url)return false;
    try{if(String(await page.mainFrame().evaluate(()=>performance.timeOrigin))!==proof.main)return false;for(const [frame,generation] of proof.frames)if(frame.isDetached()||String(await frame.evaluate(()=>performance.timeOrigin))!==generation)return false;const fresh=await read(signal);return fresh.fingerprint===e.fingerprint;}catch{return false;}
  }};
}
