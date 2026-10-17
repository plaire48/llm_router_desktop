// Renderer promises can outlive an SSO document (notably a closing Windows
// popup). Bind each read to that document and the explicit login attempt.
function readMailPage(contents,source,{signal,timeout=35000}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(Error('mail_cancelled'));return;}
  if(contents.isDestroyed?.()){reject(Error('mail_portal_login'));return;}
  let finished=false;
  const finish=(error,value)=>{
   if(finished)return;finished=true;clearTimeout(timer);
   contents.removeListener?.('did-start-navigation',navigation);
   contents.removeListener?.('destroyed',gone);
   contents.removeListener?.('render-process-gone',gone);
   signal?.removeEventListener('abort',cancel);
   error?reject(error):resolve(value);
  };
  const navigation=(_event,_url,inPlace,mainFrame)=>{if(mainFrame&&!inPlace)finish(Error('mail_portal_login'));};
  const gone=()=>finish(Error('mail_portal_login'));
  const cancel=()=>finish(Error('mail_cancelled'));
  const timer=setTimeout(()=>finish(Error('mail_portal_timeout')),timeout);
  contents.on?.('did-start-navigation',navigation);
  contents.on?.('destroyed',gone);
  contents.on?.('render-process-gone',gone);
  signal?.addEventListener('abort',cancel,{once:true});
  try{Promise.resolve(contents.executeJavaScript(source)).then(value=>finish(null,value),error=>finish(error));}catch(error){finish(error);}
 });
}
module.exports={readMailPage};
