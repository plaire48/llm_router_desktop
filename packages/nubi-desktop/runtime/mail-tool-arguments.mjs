// Mail search exposes both id and sourceId. Accept equivalent single-source aliases
// without inventing a source, truncating an ID or silently selecting from several mails.
export function normalizeMailReadArgs(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return value;
 const args={...value},aliases=['sourceId','source_id','mailId','mail_id'];
 const ids=[args.id,...aliases.map(key=>args[key])].filter(id=>id!==undefined);
 if(ids.length&&ids.every(id=>typeof id==='string'&&id===ids[0])){
  args.id=ids[0];for(const key of aliases)delete args[key];
 }
 // JSON adapters sometimes quote the offset. Only a canonical non-negative
 // integer is lossless; the declared schema still enforces its upper bound.
 if(typeof args.offset==='string'&&/^(0|[1-9]\d*)$/.test(args.offset)&&Number.isSafeInteger(Number(args.offset)))args.offset=Number(args.offset);
 return args;
}
