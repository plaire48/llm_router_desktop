// source_search arguments as different models send them (user report 2026-10-14: Claude Code with Sonnet 5.5 broke on
// the input format). Aliases are folded into the one shape searchSource validates; unknown keys are dropped.
const QUERY=['query','pattern','text','q','search','keyword','term','needle'];
const WITHIN=['within','path','directory','dir','folder','file','scope','glob','in'];
const MODE={content:'content',contents:'content',text:'content',grep:'content',search:'content',path:'path',paths:'path',files:'path',file:'path',filename:'path',filenames:'path',name:'path',names:'path',list:'path'};
const KIND={all:'all',wiki:'wiki',source:'all',code:'all',project:'all',docs:'wiki'};
const first=value=>Array.isArray(value)?value.find(item=>typeof item==='string'&&item.trim())??value[0]:value;
const text=value=>{const item=first(value);return typeof item==='string'?item:typeof item==='number'?String(item):undefined;};
export function normalizeSearchArgs(args){
  if(!args||typeof args!=='object'||Array.isArray(args))return {};
  const out={};
  for(const key of QUERY){const value=text(args[key]);if(value!==undefined){out.query=value.trim();break;}}
  for(const key of WITHIN){const value=text(args[key]);if(value!==undefined&&value.trim()){out.within=value.trim();break;}}
  const mode=text(args.mode??args.type??args.target);if(mode!==undefined){const mapped=MODE[mode.trim().toLowerCase()];out.mode=mapped||mode;}
  const kind=text(args.kind??args.source);if(kind!==undefined){const mapped=KIND[kind.trim().toLowerCase()];out.kind=mapped||kind;}
  // A glob like "src/**/*.ts" names a directory scope; the search itself is exact text, so the file pattern is dropped.
  if(typeof out.within==='string'&&/[*?]/.test(out.within)){const base=out.within.split(/[*?]/)[0].replace(/\/+$/,'');if(base)out.within=base;else delete out.within;}
  return out;
}
