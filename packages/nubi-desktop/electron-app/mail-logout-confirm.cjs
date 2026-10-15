// Acknowledging the known expired-session notice is not submitting credentials.
// Run only in the user-opened company login tab; never in arbitrary web pages.
function logoutNotice(url){try{const value=new URL(url);return value.protocol==='https:'&&!value.username&&!value.password&&!value.port&&['www.samsung.net','samsung.net'].includes(value.hostname)&&/^\/loginapp\/(?:abnormal-logout|logout)\/?$/.test(value.pathname);}catch{return false;}}
// Keep browser code literal: build-time function naming helpers are unavailable in the page.
const logoutConfirmationScript=String.raw`(function acknowledgeLogout(){
 const url=new URL(location.href);
 if(url.protocol!=='https:'||url.username||url.password||url.port||!['www.samsung.net','samsung.net'].includes(url.hostname)||!/^\/loginapp\/(?:abnormal-logout|logout)\/?$/.test(url.pathname))return 'unrelated';
 if(document.documentElement.dataset.nubiLogoutAcknowledged==='true')return 'already';
 const visible=element=>{const style=getComputedStyle(element);return !!element.getClientRects().length&&style.visibility!=='hidden'&&style.display!=='none'&&!element.disabled&&element.getAttribute('aria-disabled')!=='true';};
 if([...document.querySelectorAll('input[type="password"]')].some(visible))return 'login';
 const candidates=[...document.querySelectorAll('button,input[type="button"],input[type="submit"],a,[role="button"]')].filter(element=>visible(element)&&/^(확인|ok)$/i.test((element.innerText||element.value||element.getAttribute('aria-label')||'').trim()));
 if(candidates.length!==1)return 'waiting';
 const button=candidates[0];if(button.closest('form')?.querySelector('input[type="password"]'))return 'login';
 document.documentElement.dataset.nubiLogoutAcknowledged='true';button.click();return 'acknowledged';
})()`;
async function confirmLogoutNotice(contents){
 if(!contents||contents.isDestroyed()||contents.isLoadingMainFrame()||!logoutNotice(contents.getURL()))return false;
 try{return await contents.executeJavaScript(logoutConfirmationScript,true)==='acknowledged';}catch{return false;}
}
module.exports={logoutNotice,logoutConfirmationScript,confirmLogoutNotice};
