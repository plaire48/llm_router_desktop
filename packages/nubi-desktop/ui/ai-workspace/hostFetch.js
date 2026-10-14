// The ai_workspace sources fetch GitHub directly with a token from localStorage. In Nubi the SSO token stays in the
// main process, so every GitHub call goes through the host, which adds the credential and bounds the response.
const decode=value=>{const binary=atob(value||'');const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;};
const encode=bytes=>{let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);};
export async function ghesFetch(input,options={}){
 const url=typeof input==='string'?input:input?.url||String(input);
 const headers={};for(const [key,value] of new Headers(options.headers||{}).entries())if(key.toLowerCase()!=='authorization')headers[key]=value;
 let body=null,bodyEncoding='text';
 if(options.body!=null){
  if(typeof options.body==='string')body=options.body;
  else if(options.body instanceof ArrayBuffer||ArrayBuffer.isView(options.body)){body=encode(options.body instanceof ArrayBuffer?new Uint8Array(options.body):new Uint8Array(options.body.buffer,options.body.byteOffset,options.body.byteLength));bodyEncoding='base64';}
  else if(typeof Blob!=='undefined'&&options.body instanceof Blob){body=encode(new Uint8Array(await options.body.arrayBuffer()));bodyEncoding='base64';}
  else body=String(options.body);
 }
 if(options.signal?.aborted)throw new DOMException('aborted','AbortError');
 const result=await window.nubi.request('ghesFetch',{url,method:options.method||'GET',headers,body,bodyEncoding,redirect:options.redirect||'follow'});
 if(result?.__nubiError)throw Object.assign(new Error(result.__nubiError),{code:result.__nubiError});
 if(options.signal?.aborted)throw new DOMException('aborted','AbortError');
 const bytes=result.body?decode(result.body):new Uint8Array(0);
 const response=new Response(bytes,{status:result.status,statusText:result.statusText||'',headers:result.headers||{}});
 Object.defineProperty(response,'url',{value:result.url||url});
 return response;
}
