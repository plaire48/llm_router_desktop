import DOMPurify from 'dompurify';

const tags=['img','div','span','p','br','hr','b','strong','i','em','u','s','strike','small','sub','sup','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','table','thead','tbody','tfoot','tr','td','th','caption','colgroup','col','a','font','mark'];
const attributes=['style','href','src','alt','title','width','height','align','valign','border','cellpadding','cellspacing','colspan','rowspan','color','face','size'];
const styles=new Set(['color','background-color','font-family','font-size','font-weight','font-style','text-decoration','text-align','vertical-align','line-height','letter-spacing','white-space','border','border-top','border-right','border-bottom','border-left','border-color','border-width','border-style','border-collapse','border-spacing','border-radius','padding','padding-top','padding-right','padding-bottom','padding-left','margin','margin-top','margin-right','margin-bottom','margin-left','width','max-width','height','list-style-type']);
const webUrl=value=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}};

// Sanitize in an inert DOM, then display in a script-free, network-restricted
// frame. Mail styles cannot change the Workspace and links cannot navigate it.
export function mailHtmlDocument({html='',images=[]}={},query=''){
 const fragment=DOMPurify.sanitize(html,{ALLOWED_TAGS:tags,ALLOWED_ATTR:attributes,ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false,RETURN_DOM_FRAGMENT:true});
 for(const element of fragment.querySelectorAll('*')){
  if(element.hasAttribute('style')){
   for(const property of [...element.style])if(!styles.has(property)||/url\s*\(|expression\s*\(|var\s*\(|@|\\/i.test(element.style.getPropertyValue(property)))element.style.removeProperty(property);
  }
  if(element.tagName==='A'){
   const href=webUrl(element.getAttribute('href'));element.removeAttribute('href');
   if(href){element.dataset.mailHref=href;element.setAttribute('role','link');element.setAttribute('tabindex','0');element.setAttribute('title',href);}
  }
  if(element.tagName==='IMG'){
   const original=element.getAttribute('src')||'';
   let cid=original.replace(/^cid:/i,'');try{cid=decodeURIComponent(cid);}catch{}
   const embedded=/^cid:/i.test(original)?images.find(image=>image.cid===cid):null;
   const src=embedded?.src||webUrl(original)||(/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(original)&&original.length<14*1024*1024?original:null);
   if(src){element.setAttribute('src',src);element.setAttribute('referrerpolicy','no-referrer');element.setAttribute('loading','lazy');element.setAttribute('decoding','async');}
   else {const missing=document.createElement('span');missing.className='mail-image-missing';missing.textContent=element.getAttribute('alt')||'본문 이미지를 불러올 수 없어요';element.replaceWith(missing);}
  }

 }
 const terms=[...new Set(query.trim().split(/\s+/).filter(Boolean))].sort((a,b)=>b.length-a.length);
 if(terms.length){
  const expression=new RegExp(`(${terms.map(term=>/^[a-z0-9]{1,3}$/i.test(term)?`(?<![a-z0-9])${term}(?![a-z0-9])`:term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})`,'gi');
  const walker=document.createTreeWalker(fragment,NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
  for(const node of nodes){const parts=node.textContent.split(expression);if(parts.length<2)continue;const replacement=document.createDocumentFragment();parts.forEach((part,index)=>{if(index%2){const mark=document.createElement('mark');mark.textContent=part;replacement.append(mark);}else replacement.append(document.createTextNode(part));});node.replaceWith(replacement);}
 }
 const container=document.createElement('div');container.append(fragment);
 return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html{color-scheme:light}body{margin:0;padding:8px 0;color:#191F28;font:15px/1.7 Pretendard,'Noto Sans KR',sans-serif;overflow-wrap:anywhere}body>div{max-width:100%}img{max-width:100%!important;height:auto!important}.mail-image-missing{color:#4E5968;font-size:13px}table{max-width:100%;border-collapse:collapse}pre{white-space:pre-wrap}a[role=link]{color:#1B64DA;text-decoration:underline;cursor:pointer}a:focus-visible{outline:2px solid #3182F6;outline-offset:2px}mark{background:#FFF3B0;color:#191F28;border-radius:3px}blockquote{margin-inline:16px}h1,h2,h3{line-height:1.4}</style></head><body>${container.innerHTML}</body></html>`;
}
