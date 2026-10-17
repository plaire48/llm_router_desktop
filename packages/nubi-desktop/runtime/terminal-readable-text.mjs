// Readable projection for chat/copy/model previews only, never the interactive PTY.
// Parse the complete retained output, so a split escape sequence cannot leak its
// tail into a later render. Raw disk logs remain byte-for-byte evidence.
export function terminalReadableText(value){
 const text=String(value??''),out=[];let state='text',stringEscape=false,previousCR=false;
 for(const char of text){
  const code=char.codePointAt(0);
  // Broken control strings must not swallow a subsequent error line.
  if(state!=='text'&&(char==='\n'||char==='\r')){state='text';stringEscape=false;}
  if(state==='string'){
   if(code===7||code===0x9c||stringEscape&&char==='\\'){state='text';stringEscape=false;}
   else stringEscape=code===27;
   continue;
  }
  if(state==='csi'){
   if(code>=0x40&&code<=0x7e)state='text';
   else if(code===27)state='escape';
   else if(code<0x20||code>0x3f){state='text';out.push(char);}
   continue;
  }
  if(state==='escape'){
   if(char==='[')state='csi';
   else if(']PX^_'.includes(char))state='string';
   else if(code>=0x20&&code<=0x2f)state='intermediate';
   else state='text';
   continue;
  }
  if(state==='intermediate'){if(code>=0x30&&code<=0x7e)state='text';continue;}
  if(code===27){state='escape';continue;}
  if(code===0x9b){state='csi';continue;}
  if([0x90,0x98,0x9d,0x9e,0x9f].includes(code)){state='string';continue;}
  // Keep successive progress values as separate observations, rather than
  // pretending this plain-text transcript is a screen emulator.
  if(char==='\r'){out.push('\n');previousCR=true;continue;}
  if(char==='\n'){if(!previousCR)out.push('\n');previousCR=false;continue;}
  previousCR=false;
  if(char==='\b'){if(out.length&&out.at(-1)!=='\n')out.pop();continue;}
  if(code<32&&char!=='\t'||code>=0x7f&&code<=0x9f)continue;
  out.push(char);
 }
 return out.join('');
}
