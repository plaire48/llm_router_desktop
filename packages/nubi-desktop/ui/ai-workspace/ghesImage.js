// Company GitHub images (avatars, app icons) load through the desktop host, which holds the company session; the
// renderer itself cannot authenticate to GHES (user report 2026-10-14: photos missing). Web builds keep the URL.
// Photos can live on the avatars (or media) host of the same server when GHES uses subdomain isolation (2026-10-14).
const GHES_HOST='code.sdsdev.co.kr';
const GHES_IMAGE_HOSTS=new Set([GHES_HOST,'avatars.'+GHES_HOST,'media.'+GHES_HOST]);
export function ghesImageUrl(value){
  try{const url=new URL(String(value||''));if(url.protocol==='https:'&&!url.port&&GHES_IMAGE_HOSTS.has(url.hostname)&&!url.username&&!url.password&&typeof window!=='undefined'&&window.nubi?.desktop===true)return 'nubi-ghes://image/?u='+encodeURIComponent(url.href);}catch{}
  return value;
}
