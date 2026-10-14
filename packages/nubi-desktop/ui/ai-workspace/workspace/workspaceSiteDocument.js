import {parse} from 'es-module-lexer/js';
const init=Promise.resolve();
import {fromBase64,toBase64} from '../skills/skillPackage.js';
import {siteMime} from './workspaceSite.js';
import {rewriteCssReferences,rewriteSourceSet} from './workspaceSiteReferences.js';

export const SITE_ORIGIN='https://workspace-files.invalid/';
const encoded=path=>path.split('/').map(encodeURIComponent).join('/');
const virtual=path=>SITE_ORIGIN+encoded(path);
const text=file=>new TextDecoder().decode(fromBase64(file.content));
const data=(mime,value)=>`data:${mime};base64,${toBase64(new TextEncoder().encode(value))}`;
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');

// Runs only inside the opaque-origin sandbox. No session or application state is passed in.
function siteRuntime(config,rewriteCssReferences,rewriteSourceSet){
  const resolve=(value,base=config.base)=>{try{return new URL(String(value),base).href;}catch{return String(value);}};
  const path=url=>{try{const parsed=new URL(url),locationRoot=new URL('./',config.documentUrl);if(parsed.origin===new URL(config.base).origin)return decodeURIComponent(parsed.pathname.slice(1));if(parsed.origin===locationRoot.origin&&parsed.pathname.startsWith(locationRoot.pathname))return decodeURIComponent(parsed.pathname.slice(locationRoot.pathname.length));return null;}catch{return null;}};
  for(const name of ['local','session']){
    const values=Object.assign(Object.create(null),config.storage[name]||{});
    const update=next=>{
      if(Object.keys(next).length>1000||Object.keys(next).some(key=>key.length>512)||JSON.stringify(next).length>1024*1024)throw new DOMException('페이지 저장 공간이 부족합니다.','QuotaExceededError');
      for(const key of Object.keys(values))delete values[key];Object.assign(values,next);
      parent.postMessage({type:'workspace-storage',nonce:config.nonce,area:name,values:{...values}},'*');
    };
    const methods={getItem:key=>Object.hasOwn(values,String(key))?values[String(key)]:null,setItem:(key,value)=>update({...values,[String(key)]:String(value)}),removeItem:key=>{const next={...values};delete next[String(key)];update(next);},clear:()=>update({}),key:index=>Object.keys(values)[Number(index)]??null};
    const storage=new Proxy(Object.create(null),{get:(_,key)=>key==='length'?Object.keys(values).length:Object.hasOwn(methods,key)?methods[key]:values[key],set:(_,key,value)=>{methods.setItem(key,value);return true;},deleteProperty:(_,key)=>{methods.removeItem(key);return true;},ownKeys:()=>Object.keys(values),getOwnPropertyDescriptor:(_,key)=>Object.hasOwn(values,key)?{value:values[key],configurable:true,enumerable:true,writable:true}:undefined});
    Object.defineProperty(globalThis,`${name}Storage`,{value:storage,configurable:false});
  }
  const resource=value=>{
    const url=resolve(value),file=path(url);
    return file&&config.assets[file]?config.assets[file]+new URL(url).hash:value;
  };
  globalThis.__workspaceImport=(value,base)=>resolve(value,base);
  const originalFetch=globalThis.fetch.bind(globalThis);
  globalThis.fetch=async(input,options)=>{
    const url=resolve(typeof input==='string'||input instanceof URL?input:input.url),file=path(url);
    if(file!==null){
      const content=config.raw[file]||config.assets[file];if(!content)return new Response('File not found',{status:404});
      if((options?.method||input?.method||'GET').toUpperCase()!=='GET')return new Response('Static files only',{status:405});
      return originalFetch(content);
    }
    return originalFetch(input,options);
  };
  const css=value=>rewriteCssReferences(String(value),resource);
  const srcset=value=>rewriteSourceSet(String(value),resource);
  for(const [Constructor,key] of [[HTMLImageElement,'src'],[HTMLImageElement,'srcset'],[HTMLScriptElement,'src'],[HTMLLinkElement,'href'],[HTMLMediaElement,'src'],[HTMLSourceElement,'src'],[HTMLSourceElement,'srcset'],[HTMLVideoElement,'poster']]){
    const descriptor=Object.getOwnPropertyDescriptor(Constructor.prototype,key);
    if(descriptor?.set)Object.defineProperty(Constructor.prototype,key,{...descriptor,set(value){descriptor.set.call(this,key==='srcset'?srcset(value):resource(value));}});
  }
  const linked=element=>['link','image','feimage'].includes(element.localName.toLowerCase());
  const attribute=(element,name,value)=>name==='style'?css(value):name==='srcset'?srcset(value):/^(?:src|poster)$/i.test(name)||/^(?:xlink:)?href$/i.test(name)&&linked(element)?resource(value):value;
  const setAttribute=Element.prototype.setAttribute,setAttributeNS=Element.prototype.setAttributeNS;
  Element.prototype.setAttribute=function(name,value){return setAttribute.call(this,name,attribute(this,name,String(value)));};
  Element.prototype.setAttributeNS=function(namespace,name,value){return setAttributeNS.call(this,namespace,name,attribute(this,name,String(value)));};
  for(const key of ['cssText','background','backgroundImage','mask','maskImage','webkitMask','webkitMaskImage','borderImage','borderImageSource','listStyle','listStyleImage','cursor','content']){
    const descriptor=Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype,key);
    if(descriptor?.set)Object.defineProperty(CSSStyleDeclaration.prototype,key,{...descriptor,set(value){descriptor.set.call(this,css(value));}});
  }
  const setProperty=CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty=function(name,value,priority){return setProperty.call(this,name,css(value),priority);};
  for(const name of ['insertRule','replace','replaceSync']){
    const original=CSSStyleSheet.prototype[name];
    if(original)CSSStyleSheet.prototype[name]=function(value,...args){return original.call(this,css(value),...args);};
  }
  const update=element=>{
    for(const name of ['src','srcset','poster','style',...(linked(element)?['href','xlink:href']:[])]){
      const value=element.getAttribute(name);if(!value)continue;
      const next=attribute(element,name,value);if(next!==value)element.setAttribute(name,next);
    }
    if(element.localName==='style'){const next=css(element.textContent);if(next!==element.textContent)element.textContent=next;}
  };
  new MutationObserver(records=>{for(const record of records){
    if(record.type==='attributes')update(record.target);
    else if(record.target.nodeType===1&&record.target.localName==='style')update(record.target);
    else if(record.type==='characterData'&&record.target.parentElement?.localName==='style')update(record.target.parentElement);
    for(const node of record.addedNodes)if(node.nodeType===1){update(node);node.querySelectorAll('*').forEach(update);}
  }}).observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['src','srcset','poster','href','xlink:href','style']});
  document.addEventListener('click',event=>{
    const anchor=event.target.closest?.('a[href]');if(!anchor)return;
    if(anchor.getAttribute('href').startsWith('#'))return;
    const url=resolve(anchor.getAttribute('href')),file=path(url);
    if(file&&config.pages.includes(file)&&!anchor.hasAttribute('download')){event.preventDefault();parent.postMessage({type:'workspace-page',nonce:config.nonce,path:file,hash:new URL(url).hash},'*');}
  });
  if(config.fragment)addEventListener('DOMContentLoaded',()=>document.getElementById(decodeURIComponent(config.fragment.slice(1)))?.scrollIntoView());
}

export async function buildWorkspaceDocument(site,{entry=site.entry,nonce='',fragment='',documentUrl=new URL('workspace-runner.html',globalThis.location?.href||'https://workspace.test/').href,storage={local:{},session:{}}}={}){
  await init;
  const files=new Map(site.files.map(file=>[file.path,file]));
  if(!files.has(entry)||!/\.html?$/i.test(entry))throw Error('시작 페이지를 찾지 못했습니다.');
  const document=new DOMParser().parseFromString(text(files.get(entry)),'text/html');
  const imports=Object.create(null),assets=Object.create(null),raw=Object.create(null),building=new Set();
  for(const script of document.querySelectorAll('script[type="importmap"]')){
    let mapping;try{mapping=JSON.parse(script.textContent);}catch{throw Error('HTML의 importmap 형식을 확인하세요.');}
    for(const [key,value] of Object.entries(mapping.imports||{}))imports[key]=new URL(value,virtual(entry)).href;
    script.remove();
  }
  const local=(value,from)=>{
    if(/^(?:data:|blob:|#)/i.test(value))return null;
    let url;try{url=new URL(value,virtual(from));}catch{return null;}
    if(url.origin!==new URL(SITE_ORIGIN).origin)return null;
    const path=decodeURIComponent(url.pathname.slice(1));
    if(!files.has(path))throw Error(`함께 선택할 파일: ${path}`);
    return {path,hash:url.hash};
  };
  const moduleSpecifier=(value,from)=>{
    const prefix=Object.entries(imports).find(([key])=>key.endsWith('/')&&value.startsWith(key));
    const target=imports[value]||(prefix?prefix[1]+value.slice(prefix[0].length):value);
    if(!target.startsWith('.')&&!target.startsWith('/')&&!/^[a-z][\w+.-]*:/i.test(target))return target;
    const match=local(target,from);return match?virtual(match.path):target;
  };
  const rewriteJS=(source,from)=>{
    let records;try{[records]=parse(source);}catch{throw Error(`JavaScript 파일을 확인하세요: ${from}`);}
    const replacements=[];
    for(const record of records){
      if(record.d===-2)replacements.push({start:record.s,end:record.e,value:`({url:${json(virtual(from))},resolve:value=>new URL(value,${json(virtual(from))}).href})`});
      else if(record.n!==undefined){const resolved=moduleSpecifier(record.n,from);replacements.push({start:record.s,end:record.e,value:record.d>=0?json(resolved):JSON.stringify(resolved).slice(1,-1)});}
      else if(record.d>=0){replacements.push({start:record.e,end:record.e,value:`,${json(virtual(from))})`},{start:record.s,end:record.s,value:'globalThis.__workspaceImport('});}
    }
    for(const replacement of replacements.sort((a,b)=>b.start-a.start))source=source.slice(0,replacement.start)+replacement.value+source.slice(replacement.end);
    return source;
  };
  const resource=(value,from)=>{const match=local(value,from);return match?asset(match.path)+match.hash:value;};
  const css=(source,from)=>rewriteCssReferences(source,value=>resource(value,from));
  const svg=(source,from)=>{
    const document=new DOMParser().parseFromString(source,'image/svg+xml');
    if(document.querySelector('parsererror'))return source;
    for(const element of document.querySelectorAll('*')){
      if(['image','feImage'].includes(element.localName))for(const name of ['href','xlink:href'])if(element.hasAttribute(name))element.setAttribute(name,resource(element.getAttribute(name),from));
      for(const attr of Array.from(element.attributes))if(attr.value.includes('url('))element.setAttribute(attr.name,css(attr.value,from));
      if(element.localName==='style')element.textContent=css(element.textContent,from);
    }
    return new XMLSerializer().serializeToString(document);
  };
  const asset=path=>{
    if(assets[path])return assets[path];
    if(building.has(path))throw Error(`순환된 CSS 참조를 확인하세요: ${path}`);
    building.add(path);const file=files.get(path),mime=siteMime(path);
    const value=mime==='text/css'?data(mime,css(text(file),path)):mime==='text/javascript'?data(mime,rewriteJS(text(file),path)):mime==='image/svg+xml'?data(mime,svg(text(file),path)):`data:${mime};base64,${file.content}`;
    building.delete(path);assets[path]=value;return value;
  };
  for(const file of site.files){asset(file.path);if(['text/css','text/javascript'].includes(siteMime(file.path)))raw[file.path]=`data:${siteMime(file.path)};base64,${file.content}`;}
  for(const file of site.files)if(['text/javascript','application/json'].includes(siteMime(file.path)))imports[virtual(file.path)]=assets[file.path];
  // Keep explicit aliases, including modules used by an import map.
  for(const [key,value] of Object.entries(imports))if(!key.startsWith(SITE_ORIGIN)){if(key.endsWith('/')){delete imports[key];continue;}const match=local(value,entry);if(match)imports[key]=assets[match.path];}
  document.querySelectorAll('base,meta[http-equiv]').forEach(node=>node.remove());
  for(const element of document.querySelectorAll('*')){
    for(const attr of ['src','poster',...(['link','image','feimage'].includes(element.localName.toLowerCase())?['href','xlink:href']:[])])if(element.hasAttribute(attr))element.setAttribute(attr,resource(element.getAttribute(attr),entry));
    if(element.hasAttribute('srcset'))element.setAttribute('srcset',rewriteSourceSet(element.getAttribute('srcset'),value=>resource(value,entry)));
    if(element.hasAttribute('style'))element.setAttribute('style',css(element.getAttribute('style'),entry));
    if(element.tagName==='STYLE')element.textContent=css(element.textContent,entry);
    if(element.tagName==='SCRIPT'&&!element.src&&['','module','text/javascript','application/javascript'].includes(element.type))element.textContent=rewriteJS(element.textContent,entry);
    element.removeAttribute('integrity');
  }
  const base=document.createElement('base');base.href=documentUrl;
  const map=document.createElement('script');map.type='importmap';map.textContent=json({imports});
  const boot=document.createElement('script');boot.textContent=`(${siteRuntime.toString()})(${json({base:virtual(entry),documentUrl,assets,raw,storage,pages:site.files.filter(file=>/\.html?$/i.test(file.path)).map(file=>file.path),nonce,fragment})},${rewriteCssReferences.toString()},${rewriteSourceSet.toString()});`;
  document.head.prepend(base,map,boot);
  return {html:'<!doctype html>'+document.documentElement.outerHTML,title:document.title};
}
