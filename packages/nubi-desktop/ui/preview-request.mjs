// A read-only preview may time out without cancelling or retrying a host action.
// Late completion is observed by Promise.race and never updates a settled view.
export async function previewRequest(request,timeoutMs=15000){
 let timer;
 try{return await Promise.race([Promise.resolve().then(request),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('preview_timeout')),timeoutMs);})]);}
 finally{clearTimeout(timer);}
}
