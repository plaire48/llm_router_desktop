// Decode text attachments without silently replacing undecodable bytes. Korean
// legacy mail commonly contains CP949; UTF-16 must be decoded before NUL checks.
export function decodeDocumentText(bytes,contentType=''){
 const declared=/charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1];
 const charset=({'cp949':'euc-kr','ms949':'euc-kr','windows-949':'euc-kr'})[declared?.toLowerCase()]||declared;
 const bom=bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf?'utf-8':bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':null;
 // Some gateways retain a UTF-8 label when the actual TXT is CP949. Honor a
 // valid declaration first, then try strict decoders instead of replacement
 // characters. A BOM remains authoritative; damaged BOM files do not fall back.
 const encodings=bom?[bom]:[...new Set([charset,'utf-8','euc-kr'].filter(Boolean))];
 for(const encoding of encodings){
  try{
   const text=new TextDecoder(encoding,{fatal:true}).decode(bytes);
   if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))continue;
   return text;
  }catch{}
 }
 throw Error('document_read_failed');
}

// Calendar attachments are evidence only. Never open URLs, invite participants
// or register events. Preserve TZID and UTC/date values without guessing zones.
export function calendarText(text){
 const lines=text.replace(/\r?\n[ \t]/g,'').split(/\r?\n/);
 if(!lines.some(line=>/^BEGIN:VCALENDAR$/i.test(line.trim()))||!lines.some(line=>/^END:VCALENDAR$/i.test(line.trim())))throw Error('document_format');
 const labels={SUMMARY:'일정',DTSTART:'시작',DTEND:'종료',DUE:'기한',DESCRIPTION:'설명',LOCATION:'장소',ORGANIZER:'주최자',ATTENDEE:'참석자',STATUS:'상태',RRULE:'반복','RECURRENCE-ID':'반복 일정',UID:'일정 ID',URL:'링크'};
 return lines.map(line=>{
  let colon=-1,quoted=false;
  for(let index=0;index<line.length;index++){
   if(line[index]==='"')quoted=!quoted;
   if(line[index]===':'&&!quoted){colon=index;break;}
  }
  if(colon<1)return line;
  const head=line.slice(0,colon),separator=head.indexOf(';'),name=separator<0?head:head.slice(0,separator),params=separator<0?'':head.slice(separator),value=line.slice(colon+1),key=name.toUpperCase();
  if(key==='BEGIN'||key==='END')return `${key}: ${value}`;
  const decoded=value.replace(/\\([nN,;\\])/g,(_,char)=>/[nN]/.test(char)?'\n':char);
  return `${labels[key]||name}${params?' ('+params.slice(1)+')':''}: ${decoded}`;
 }).join('\n');
}
