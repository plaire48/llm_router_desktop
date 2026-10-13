// Startup restoration is read-only with Wiki initialization disabled by the caller.
// Retry one transient Git timeout, never permission failures or uncertain worker exits.
async function restoreSavedProject(open,{wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onEvent=()=>{},existing=()=>undefined}={}) {
 const emit=async event=>{try{await onEvent(event);}catch{}};
 for(let attempt=1;attempt<=2;attempt++) {
  if(attempt>1){const selected=await existing();if(selected!==undefined){await emit({state:'superseded',attempt});return selected;}}
  try {const value=await open();if(attempt>1)await emit({state:'recovered',attempt});return value;}
  catch(error){const code=/^[a-z_]+$/.test(error?.message||'')?error.message:'operation_failed';await emit({state:'failed',attempt,error:code});if(code!=='git_timeout'||attempt===2)throw error;await wait(300);}
 }
}
module.exports={restoreSavedProject};
