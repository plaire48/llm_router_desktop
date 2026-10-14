import {sanitizeTalkHtml} from './talkRichText.js';

// Keep the existing stored HTML/Markdown contract, but edit and display files separately.
export function splitTalkAttachmentHtml(html,storedPath) {
  const root=document.createElement('div');root.innerHTML=sanitizeTalkHtml(html);
  const files=new Map();
  root.querySelectorAll('a[href],img[src],video[src]').forEach(node=>{
    const url=node.getAttribute(node.tagName==='A'?'href':'src');
    if(!storedPath?.(url))return;
    const name=(node.getAttribute('data-name')||node.getAttribute('alt')||node.getAttribute('title')||node.textContent||'첨부 파일').slice(0,200);
    const size=Number(node.getAttribute('data-size'))||0;
    if(!files.has(url)||size)files.set(url,{url,name,size});
    const parent=node.parentElement;node.remove();
    if(parent!==root&&['P','LI'].includes(parent.tagName)&&!parent.textContent.trim()&&!parent.querySelector('img,video,input'))parent.remove();
  });
  root.querySelectorAll('ul,ol').forEach(node=>{if(!node.children.length)node.remove();});
  return {html:root.innerHTML,files:[...files.values()]};
}
export function joinTalkAttachmentHtml(html,files) {
  const root=document.createElement('div');root.innerHTML=sanitizeTalkHtml(html);
  for(const file of files){
    const link=document.createElement('a');link.href=file.url;link.dataset.type='attachment';link.dataset.name=file.name;link.dataset.size=String(file.size||0);link.textContent=file.name;link.title=file.name;root.append(link);
  }
  return sanitizeTalkHtml(root.innerHTML);
}
export async function downloadTalkAttachment(media,file) {
  const blob=await media.load(file.url);if(!blob)throw Error('첨부 파일을 찾지 못했습니다.');
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=file.name;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
