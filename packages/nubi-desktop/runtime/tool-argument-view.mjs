// Display-only projection. Never use this redacted/bounded value to execute a tool.
const secret=/password|passwd|secret|token|authorization|cookie|api[_-]?key|client[_-]?key/i;
export function toolArgumentView(args,{limit=20000}={}){
 let omitted=false;
 const visit=(value,key='',depth=0)=>{
  if(secret.test(key))return '[숨김]';
  if(depth>8){omitted=true;return '[중첩 항목 생략]';}
  if(typeof value==='string'){
   let text=value;
   if(/^https?:\/\//i.test(text)){try{const url=new URL(text);url.username='';url.password='';for(const k of [...url.searchParams.keys()])if(secret.test(k)||k==='code')url.searchParams.set(k,'[숨김]');if(/(?:token|code|secret)=/i.test(url.hash))url.hash='[숨김]';text=url.href;}catch{}}
   if(text.length>limit){omitted=true;text=text.slice(0,limit)+'…';}return text;
  }
  if(Array.isArray(value)){if(value.length>100)omitted=true;return value.slice(0,100).map(item=>visit(item,key,depth+1));}
  if(value&&typeof value==='object'){const entries=Object.entries(value);if(entries.length>100)omitted=true;return Object.fromEntries(entries.slice(0,100).map(([k,v])=>[k,visit(v,k,depth+1)]));}
  return value;
 };
 const text=JSON.stringify(visit(args??{}),null,2);
 return {text:text.length>limit?text.slice(0,limit)+'\n…':text,omitted:omitted||text.length>limit};
}
