// Navigation metadata only. Never retain URLs, headers, cookies or POST bodies.
const sessions=new WeakMap();
const samlKey=/^(SAMLRequest|SAMLResponse|SAMLart|RelayState|Signature|SigAlg)$/i;
function isSamlAddress(value){try{const url=new URL(value);return /saml|epsso/i.test(url.pathname)||[...url.searchParams.keys()].some(key=>samlKey.test(key));}catch{return false;}}
function displayAddress(value){
 try{const url=new URL(value),privateKey=/^(code|token|access_token|id_token|refresh_token|SAMLRequest|SAMLResponse|SAMLart|RelayState|Signature|SigAlg)$/i;for(const key of [...url.searchParams.keys()])if(privateKey.test(key))url.searchParams.delete(key);if(/(?:^|[&#])(code|token|access_token|id_token|refresh_token|SAMLRequest|SAMLResponse|SAMLart|RelayState|Signature|SigAlg)=/i.test(url.hash))url.hash='';return url.href;}catch{return value;}
}
class AuthFlow {
 constructor(parent){if(parent?.settled)parent=null;this.started=parent?.active?parent.started:Date.now();this.active=!!parent?.active;this.events=parent?.active?parent.events.map(item=>({...item})):[];this.failure=null;this.stage='opening';this.requestId=null;this.settled=false;}
 record(stage,details={}){this.stage=stage;const event={stage,elapsedMs:Math.max(0,Date.now()-this.started)};if(['GET','POST','HEAD','OPTIONS'].includes(details.method))event.method=details.method;if(Number.isInteger(details.statusCode)&&details.statusCode>=100&&details.statusCode<=599)event.httpStatus=details.statusCode;this.events.push(event);this.events=this.events.slice(-16);}
 request(details){if(this.failure||this.settled){this.events=[];this.started=Date.now();this.failure=null;this.active=false;this.settled=false;}this.requestId=details.id;const saml=isSamlAddress(details.url);this.returning=this.active&&!saml;this.active ||=saml;this.record(details.method==='POST'?'post':saml?'saml':this.active?'return':'opening',details);}
 redirect(details){if(details.id!==this.requestId)return;this.active ||=isSamlAddress(details.redirectURL);this.record('redirect',details);}
 complete(details){if(details.id!==this.requestId)return;if(details.statusCode>=400)this.fail('http_error',details);else{this.record('page',details);this.settled=!!this.returning;}}
 fail(code,details={}){this.settled=false;if(!['http_error','epsso_request_missing','navigation_blocked','popup_limit','browser_dns_failed','browser_offline','browser_timeout','browser_certificate_failed','browser_proxy_failed','browser_tls_failed','browser_connection_refused','browser_load_failed'].includes(code))code='browser_load_failed';this.failure={stage:this.stage,code};if(Number.isInteger(details.statusCode)&&details.statusCode>=400&&details.statusCode<=599)this.failure.httpStatus=details.statusCode;}
 snapshot(){return this.active?{failure:this.failure?{...this.failure}:null,events:this.events.map(item=>({...item}))}:null;}
}
function observeSession(session,wc,flow,changed){
 let entry=sessions.get(session);
 if(!entry){
  entry={tabs:new Map()};sessions.set(session,entry);
  const route=(details,operation)=>{if(details.resourceType!=='mainFrame')return;const tab=entry.tabs.get(details.webContentsId);if(!tab)return;try{operation(tab.flow,details);tab.changed();}catch{/* Diagnostics must never interrupt navigation. */}};
  session.webRequest.onBeforeRequest((details,callback)=>{callback({});route(details,(flow,event)=>flow.request(event));});
  session.webRequest.onBeforeRedirect(details=>route(details,(flow,event)=>flow.redirect(event)));
  session.webRequest.onCompleted(details=>route(details,(flow,event)=>flow.complete(event)));
 }
 entry.tabs.set(wc.id,{flow,changed});
 return()=>{entry.tabs.delete(wc.id);if(!entry.tabs.size){session.webRequest.onBeforeRequest(null);session.webRequest.onBeforeRedirect(null);session.webRequest.onCompleted(null);sessions.delete(session);}};
}
// Return a fixed classification, never page text. Do not read forms or inputs.
const epssoFailureProbe=`(()=>{const text=(document.body?.innerText||'').slice(0,65536);return /httpGet.{0,30}(?:is null|null)/is.test(text)&&/getURI|org\\.apache\\.http/i.test(text);})()`;
module.exports={AuthFlow,observeSession,isSamlAddress,displayAddress,epssoFailureProbe};
