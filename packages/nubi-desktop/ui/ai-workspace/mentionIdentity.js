import {ghesImageUrl} from './ghesImage.js';
// Presentation is derived from the current public GHES profile, never saved into the post.
export function fillMentionIdentity(element,login,user) {
 const valid=user?.login?.toLowerCase()===login.toLowerCase(),name=valid&&user.name?.trim();
 element.textContent='';
 const avatar=document.createElement('span');avatar.className='cx-mention-avatar';avatar.textContent=(name||login).slice(0,1).toUpperCase();avatar.setAttribute('aria-hidden','true');element.append(avatar);
 if(valid&&user.avatar_url){try{const url=new URL(user.avatar_url);if(url.protocol==='https:'){
  const img=document.createElement('img');img.src=ghesImageUrl(url.href);img.alt='';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>img.replaceWith(avatar));avatar.replaceWith(img);
 }}catch{/* Keep the compact avatar fallback. */}}
 const text=document.createElement('span');text.className='cx-mention-name';text.textContent=name||`@${login}`;element.append(text);
 if(name){const id=document.createElement('span');id.className='cx-mention-login';id.textContent=`(${login})`;element.append(id);}
 element.setAttribute('aria-label',`${name?`${name} (${login})`:`@${login}`} 프로필`);
}
export function hydrateMentionIdentities(root,profile) {
 let active=true;const nodes=[...(root?.querySelectorAll('[data-type=mention][data-id]')||[])];
 for(const node of nodes)fillMentionIdentity(node,node.dataset.id,null);
 if(profile)(async()=>{const names=[...new Set(nodes.map(n=>n.dataset.id))];for(let i=0;i<names.length&&active;i+=4)await Promise.all(names.slice(i,i+4).map(async login=>{try{const user=await profile(login);if(active)nodes.filter(n=>n.dataset.id===login).forEach(node=>fillMentionIdentity(node,login,user));}catch{/* ID remains usable if profile details are unavailable. */}}));})();
 return()=>{active=false;};
}
