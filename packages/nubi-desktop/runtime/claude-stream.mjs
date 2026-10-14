// Extract ONLY the public `content` string in the StructuredOutput object.
// Tool arguments, thinking blocks and CLI commentary never become answer text.
export function partialContent(json){
 let depth=0,inString=false,escape=false,start=0,key=null,expectKey=false;
 for(let i=0;i<json.length;i++){
  const c=json[i];
  if(inString){if(escape){escape=false;continue;}if(c==='\\'){escape=true;continue;}if(c==='"'){inString=false;if(depth===1&&expectKey){try{key=JSON.parse(json.slice(start,i+1));}catch{return '';}expectKey=false;}}continue;}
  if(c==='{'||c==='['){depth++;if(depth===1)expectKey=true;continue;}if(c==='}'||c===']'){depth--;continue;}
  if(c===','&&depth===1){expectKey=true;key=null;continue;}
  if(c==='"'){
   if(depth===1&&key==='content'&&!expectKey){const pieces=[];for(let j=i+1;j<json.length;j++){const char=json[j];if(char==='"')break;if(char==='\\'){const next=json[j+1];if(!next)break;if(next==='u'){const hex=json.slice(j+2,j+6);if(hex.length<4)break;if(!/^[a-f0-9]{4}$/i.test(hex))return '';pieces.push(String.fromCharCode(parseInt(hex,16)));j+=5;}else{const escapes={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};if(!Object.hasOwn(escapes,next))return '';pieces.push(escapes[next]);j++;}}else{if(char.charCodeAt(0)<32)return '';pieces.push(char);}}return pieces.join('').replace(/[\uD800-\uDBFF]$/,'');}
   inString=true;start=i;
  }
 }
 return '';
}
// Thinking reaches a separate reasoning view when the caller asks for it (user request 2026-10-14: show reasoning
// while Claude works, as Codex does); it never becomes answer text.
export function claudeStream(onText,onReasoning){
 let block=null,json='',shown='',thinkingBlock=null,thinking='';
 return event=>{
  const data=event?.type==='stream_event'?event.event:null;if(!data)return;
  if(data.type==='message_start'){block=null;json='';shown='';thinkingBlock=null;return;}
  if(onReasoning&&data.type==='content_block_start'&&data.content_block?.type==='thinking'){thinkingBlock=data.index;if(thinking)thinking+='\n\n';return;}
  if(onReasoning&&data.type==='content_block_delta'&&data.index===thinkingBlock&&data.delta?.type==='thinking_delta'&&typeof data.delta.thinking==='string'){thinking=(thinking+data.delta.thinking).slice(-20000);onReasoning(thinking);return;}
  if(data.type==='content_block_start'&&data.content_block?.type==='tool_use'&&data.content_block.name==='StructuredOutput'){block=data.index;json='';shown='';}
  if(data.type==='content_block_delta'&&data.index===block&&data.delta?.type==='input_json_delta'){
   json+=data.delta.partial_json||'';if(json.length>600000)throw Error('output_limit');
   const text=partialContent(json);if(text!==shown){shown=text;onText(text);}
  }
 };
}
