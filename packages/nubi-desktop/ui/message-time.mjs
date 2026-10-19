// Locale setup belongs to module startup, before the first conversation paints.
const fullFormat=new Intl.DateTimeFormat(undefined,{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'});
const shortFormat=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'});
const formatted=new Map();
export function formatMessageTime(at){
 if(formatted.has(at))return formatted.get(at);
 if(!at||!Number.isFinite(Date.parse(at)))return null;
 const date=new Date(at),result={iso:date.toISOString(),full:fullFormat.format(date),short:shortFormat.format(date)};
 // Host timestamps are immutable strings. Never cache mutable Date objects.
 if(typeof at==='string'){if(formatted.size>=512)formatted.delete(formatted.keys().next().value);formatted.set(at,result);}
 return result;
}
