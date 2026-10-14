// Company GitHub images for the desktop host: profile photos, custom status emoji and app icons (2026-10-14).
// GHES with subdomain isolation serves photos from avatars.<host> and redirects /avatars/u/<id> there. The earlier
// path refused every redirect off the main host, and Electron's session fetch rejects redirect:'manual' outright
// ("Redirect was cancelled"), so no photo ever loaded. Here the token goes only to the main host, the company session
// (its own cookies, managed by Chromium, never a token) follows redirects the way an <img> would, and only image
// bytes come back.
const {ORIGIN}=require('../../nubi-vscode/src/ghes.cjs');
const HOST=new URL(ORIGIN).hostname;
const IMAGE_HOSTS=new Set([HOST,'avatars.'+HOST,'media.'+HOST]);
const REDIRECTS=new Set([301,302,303,307,308]);

function ghesImageTarget(value){
 try{const url=new URL(value instanceof URL?value.href:String(value||''));return url.protocol==='https:'&&!url.port&&IMAGE_HOSTS.has(url.hostname)&&!url.username&&!url.password?url:null;}
 catch{return null;}
}
function sniffImage(bytes){
 if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(/^GIF8[79]a$/.test(bytes.subarray(0,6).toString('latin1')))return 'image/gif';
 if(bytes.length>=12&&bytes.subarray(0,4).toString('latin1')==='RIFF'&&bytes.subarray(8,12).toString('latin1')==='WEBP')return 'image/webp';
 return null;
}
async function cancel(response){try{await response?.body?.cancel();}catch{}}
// Image bytes only: a login page, JSON or anything over the limit is not an image.
async function readImage(response,limit){
 if(!response?.ok||!response.body){await cancel(response);return null;}
 const declared=String(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 if(declared&&!/^image\/[\w.+-]+$/.test(declared)&&declared!=='application/octet-stream'){await cancel(response);return null;}
 const length=Number(response.headers.get('content-length'));
 if(Number.isFinite(length)&&length>limit){await cancel(response);return null;}
 const chunks=[];let size=0;
 for await(const chunk of response.body){size+=chunk.length;if(size>limit)return null;chunks.push(Buffer.from(chunk));}
 const bytes=Buffer.concat(chunks),sniffed=sniffImage(bytes),type=sniffed||(declared.startsWith('image/')?declared:null);
 return bytes.length&&type?{bytes,type,sniffed}:null;
}
// apiFetch: the host's own HTTP client (token only while on the main host, redirects checked one by one).
// sessionFetch: the company browser session (cookies only, redirects followed by Chromium).
async function fetchGhesImage(start,{token=null,apiFetch=null,sessionFetch=null,signal,limit=8*1024*1024,maxRedirects=3}={}){
 const first=ghesImageTarget(start);if(!first)return null;
 if(apiFetch)try{
  let url=first;
  for(let redirects=0;;redirects++){
   const headers={Accept:'image/*'};if(token&&url.origin===ORIGIN)headers.Authorization='Bearer '+token;
   const response=await apiFetch(url.href,{redirect:'manual',cache:'no-store',credentials:'omit',headers,signal});
   if(!REDIRECTS.has(response.status)){const image=await readImage(response,limit);if(image)return image;break;}
   const location=response.headers.get('location');await cancel(response);
   let next=null;try{next=location?ghesImageTarget(new URL(location,url)):null;}catch{}
   if(!next||redirects>=maxRedirects)break;url=next;
  }
 }catch{if(signal?.aborted)return null;}
 if(sessionFetch&&!signal?.aborted)try{
  return await readImage(await sessionFetch(first.href,{redirect:'follow',cache:'no-store',credentials:'include',headers:{Accept:'image/*'},signal}),limit);
 }catch{}
 return null;
}
module.exports={ghesImageTarget,fetchGhesImage,readImage,sniffImage,IMAGE_HOSTS};
