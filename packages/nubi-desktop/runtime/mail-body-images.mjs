import {createHash} from 'node:crypto';
import {mailImagePreview} from './mail-image.mjs';
import {mailPartPresentation} from '../../openwiki/src/connectors/sources/pop3-content.mjs';

export const mailParts=mail=>[...(mail.attachments||[]),...(mail.inlineImages||[])];
export const unreadBodyImageReferences=mail=>(mail.bodyImageCoverage?.linked||0)+(mail.bodyImageCoverage?.missing||0)+Math.max(0,(mail.bodyImageCoverage?.data||0)-(mail.bodyImageCoverage?.dataImages?.length||0));
export const hasMailBodyImages=mail=>!!(mail.inlineImages?.length||mail.attachments?.some(part=>part.presentation==='inline')||mail.bodyImageCoverage?.linked||mail.bodyImageCoverage?.data||mail.bodyImageCoverage?.missing);

export function mailBodyImageCoverage(html='',parts=[]){
 const sources=[...String(html).matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map(match=>match[1]??match[2]??match[3]??'');
 const available=new Set(parts.map(part=>String(part.cid||part.contentId||'').replace(/^<|>$/g,''))),missing=new Set(sources.filter(src=>/^cid:/i.test(src)&&!available.has(src.slice(4)))).size;
 return {linked:new Set(sources.filter(src=>/^https?:\/\//i.test(src))).size,data:new Set(sources.filter(src=>/^data:/i.test(src))).size,...(missing?{missing}:{})};
}

export function mailDataImages(html=''){
 const images=new Map();
 for(const match of String(html).matchAll(/<img\b[^>]*\bsrc\s*=\s*["'](data:image\/(?:png|jpeg|gif|webp);base64,([a-z0-9+/=]+))["']/gi)){
  if(match[2].length>8*1024*1024)continue;
  const content=Buffer.from(match[2],'base64');if(!mailImagePreview(content))continue;
  const sha256=createHash('sha256').update(content).digest('hex'),contentType=match[1].slice(5).split(';')[0].toLowerCase();
  images.set(sha256,{id:'body-'+sha256.slice(0,24),sha256,content,contentType,size:content.length,filename:'본문 이미지.'+contentType.split('/')[1],presentation:'inline',bodyData:true,contentState:'stored_bytes_only'});
 }
 return [...images.values()];
}

// Only verified MIME bytes become data URLs. HTML/CID declarations are not
// sufficient to permit SVG, executable content or filesystem URLs.
export function mailPresentation(parsed){
 const images=[];
 for(const [index,part] of (parsed.attachments||[]).entries()){
  if(mailPartPresentation(part,parsed.html)!=='inline')continue;
  const bytes=Buffer.from(part.content),sha256=createHash('sha256').update(bytes).digest('hex');
  const src=mailImagePreview(bytes);if(!src)continue;
  images.push({id:String(index).padStart(3,'0')+'-'+sha256.slice(0,16),cid:String(part.cid||part.contentId||'').replace(/^<|>$/g,''),src,filename:part.filename||'본문 이미지',sha256});
 }
 let html=typeof parsed.html==='string'?parsed.html:'';
 for(const part of mailDataImages(html))images.push({id:part.id,cid:'nubi-'+part.id,src:mailImagePreview(part.content),filename:part.filename,sha256:part.sha256});
 // Replace large embedded payloads before bounding the HTML, so a valid image
 // does not get cut in half by the text presentation limit.
 html=html.replace(/data:image\/(?:png|jpeg|gif|webp);base64,([a-z0-9+/=]+)/gi,(value,base64)=>{
  if(base64.length>8*1024*1024)return '';
  const sha256=createHash('sha256').update(Buffer.from(base64,'base64')).digest('hex'),image=images.find(item=>item.id.startsWith('body-')&&item.sha256===sha256);
  return image?'cid:'+image.cid:'';
 });
 return {html:html.slice(0,500000),images};
}
