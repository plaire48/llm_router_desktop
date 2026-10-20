import type {ElementHandle,Frame,Locator,Page} from 'playwright-core';
import type {DocumentEvidence,DocumentReadHost,ObservedDocumentLink} from './research.js';
import type {Observation,OperationContext} from './types.js';
import {fail} from './contracts.js';

export interface DocumentReaderOptions {
  page(tabId:string):Page;
  roots(page:Page):readonly {frame:Frame;root:Locator}[];
  /** Called before DOM reads and again before returning any evidence. */
  access(page:Page,context:OperationContext):Promise<boolean>;
  allowUrl(url:string,context:OperationContext):Promise<boolean>;
  /** The host must guard navigation redirects; open allocates a separate temporary read page. */
  open(url:string,context:OperationContext):Promise<Page>;
  close(page:Page):Promise<void>;
  ready(page:Page,context:OperationContext):Promise<void>;
  /** Optional host wiki acquisition, using only screen structure, never the extracted answer. */
  knowledge?(page:Page,context:OperationContext):Promise<void>;
  maxCharacters?:number;
  /** Exact semantic heading names chosen by the host task. Missing headings fall back to the full scope. */
  focusHeadings?:readonly string[];
}
const digest=async(text:string)=>'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');
const safeUrl=(text:string)=>{const u=new URL(text);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)fail('document_url_invalid');u.hash='';return u.href;};
/** Host-owned Page adapter. It opens no browser, invents no URLs and executes no model scripts. */
export function createPlaywrightDocumentReader(options:DocumentReaderOptions):DocumentReadHost {
  const limit=options.maxCharacters??24000;if(!Number.isInteger(limit)||limit<1000||limit>32000)fail('document_limit_invalid');
  const focus=[...(options.focusHeadings??[])];if(focus.length>12||focus.some(x=>!x.trim()||x.length>120)||new Set(focus).size!==focus.length)fail('document_focus_invalid');
  const captures=new Map<string,{page:Page;url:string;generation:string;links:Map<string,{handle:ElementHandle;url:string;frame:Frame;generation:string}>}>();
  const access=async(page:Page,ctx:OperationContext)=>{ctx.signal.throwIfAborted();if(page.isClosed()||!await options.allowUrl(page.url(),ctx)||!await options.access(page,ctx))fail('document_access_denied');ctx.signal.throwIfAborted();};
  return {
    async capture(ctx,observation){const page=options.page(observation.binding.tabId);await access(page,ctx);
      const generation=String(await page.evaluate(()=>performance.timeOrigin)),url=page.url(),links=new Map<string,{handle:ElementHandle;url:string;frame:Frame;generation:string}>(),result:ObservedDocumentLink[]=[];
      captures.set(observation.observationId,{page,url,generation,links});
      const roots=options.roots(page);if(roots.length>16)fail('document_roots_invalid');
      for(const item of roots){if(item.frame.page()!==page||item.frame.isDetached()||await item.root.count()!==1)fail('document_roots_invalid');
        const locator=item.root.locator('a[href]'),handles=await locator.elementHandles(),rootHandle=await item.root.elementHandle();
        if(rootHandle){if(await rootHandle.evaluate(el=>el.matches('a[href]')))handles.unshift(rootHandle);else await rootHandle.dispose();}
        for(const handle of handles){let retained=false;try{
          if(result.length===48)continue;const data=await handle.evaluate(el=>{const a=el as HTMLAnchorElement,r=a.getBoundingClientRect(),s=getComputedStyle(a);return {visible:!!r.width&&!!r.height&&s.display!=='none'&&s.visibility!=='hidden',url:a.href,title:(a.innerText||a.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim().slice(0,240)};});
          if(!data.visible||!data.title)continue;let target;try{target=safeUrl(data.url);}catch{continue;}
          if(!await options.allowUrl(target,ctx)||result.some(x=>x.url===target))continue;
          if(await handle.ownerFrame()!==item.frame)fail('document_roots_invalid');
          const linkId=crypto.randomUUID();links.set(linkId,{handle,url:target,frame:item.frame,generation:String(await item.frame.evaluate(()=>performance.timeOrigin))});retained=true;result.push({linkId,title:data.title,url:target});
        }finally{if(!retained)await handle.dispose();}}
      }
      return result;
    },
    async validate(ctx,observation,links){const entry=captures.get(observation.observationId);if(!entry||entry.page!==options.page(observation.binding.tabId))return false;
      try{await access(entry.page,ctx);if(entry.page.url()!==entry.url||String(await entry.page.evaluate(()=>performance.timeOrigin))!==entry.generation)return false;
        for(const link of links){const old=entry.links.get(link.linkId);if(!old||old.url!==link.url||old.frame.isDetached()||String(await old.frame.evaluate(()=>performance.timeOrigin))!==old.generation||!await old.handle.evaluate(el=>el.isConnected))return false;
          const href=await old.handle.evaluate(el=>(el as HTMLAnchorElement).href);if(safeUrl(href)!==old.url||!await options.allowUrl(old.url,ctx))return false;}
        return true;
      }catch{ctx.signal.throwIfAborted();return false;}
    },
    async read(ctx,link):Promise<DocumentEvidence>{ctx.signal.throwIfAborted();if(!await options.allowUrl(link.url,ctx))fail('document_access_denied');let page:Page|undefined;
      try{const opened=await options.open(link.url,ctx);if([...captures.values()].some(x=>x.page===opened))fail('document_page_not_isolated');page=opened;await access(page,ctx);await options.ready(page,ctx);await access(page,ctx);
        await options.knowledge?.(page,ctx);await access(page,ctx);
        const url=safeUrl(page.url()),generation=String(await page.evaluate(()=>performance.timeOrigin));const textParts:string[]=[],selected:string[]=[],missing:string[]=[];const roots=options.roots(page);
        if(!roots.length||roots.length>16)fail('document_roots_invalid');
        for(const item of roots){if(item.frame.page()!==page||item.frame.isDetached()||await item.root.count()!==1)fail('document_roots_invalid');const handle=await item.root.elementHandle();if(!handle)fail('document_roots_invalid');
          try{if(await handle.ownerFrame()!==item.frame)fail('document_roots_invalid');const section=await handle.evaluate((root,focus)=>{
            const normalize=(s:string)=>s.replace(/[\s#]+/g,'').trim(),headings=Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'));
            const found=focus.map(term=>headings.find(h=>normalize(h.textContent??'')===normalize(term))),missing=focus.filter((_,i)=>!found[i]);
            const ranges:Range[]=[];if(focus.length&&!missing.length)for(const h of found){const index=headings.indexOf(h!),level=Number(h!.tagName[1]),next=headings.slice(index+1).find(x=>Number(x.tagName[1])<=level),range=document.createRange();range.setStartBefore(h!);if(next)range.setEndBefore(next);else range.setEndAfter(root.lastChild??root);ranges.push(range);}
            const parts:string[]=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node:Node|null;
            while((node=walker.nextNode())){let parent=node.parentElement,visible=true;
              if(ranges.length&&!ranges.some(range=>range.intersectsNode(node!)))continue;
              while(parent){const s=getComputedStyle(parent);if(parent.matches('script,style,nav,header,footer,input,textarea,select,[contenteditable],[hidden],[aria-hidden=true]')||ranges.length&&parent.tagName==='PRE'||s.display==='none'||s.visibility==='hidden'){visible=false;break;}if(parent===root)break;parent=parent.parentElement;}
              const text=node.textContent?.replace(/\s+/g,' ').trim();if(visible&&text)parts.push(text);
            }return {text:parts.join('\n'),headings:focus.filter((_,i)=>!!found[i]),missing};
          },focus);textParts.push(section.text);selected.push(...section.headings);missing.push(...section.missing);}finally{await handle.dispose();}}
        const title=(await page.title()).slice(0,240),full=textParts.join('\n'),text=full.slice(0,limit);if(!text||!title)fail('document_empty');
        await access(page,ctx);if(safeUrl(page.url())!==url||String(await page.evaluate(()=>performance.timeOrigin))!==generation)fail('document_changed');
        return {sourceId:'source:'+crypto.randomUUID(),url,title,text,truncated:full.length>limit,observedAt:new Date().toISOString(),contentHash:await digest(full),...(focus.length?{selection:{kind:missing.length?'full' as const:'headings' as const,headings:[...new Set(selected)],missing:[...new Set(missing)]}}:{})};
      }finally{if(page)await options.close(page);}
    },
    async forget(observationId){const entry=captures.get(observationId);captures.delete(observationId);await Promise.allSettled([...(entry?.links.values()??[])].map(x=>x.handle.dispose()));},
  };
}
