import {GHES_CONFIG} from './config.js';
import {TALK_LIMITS,talkError} from './talkModel.js';

const prefix='<!-- workspace-attachments:v1:';
const escapeName=name=>name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\[\]]/g,'\\$&');
export function commentAttachments(files){
  if(!Array.isArray(files)||files.length>TALK_LIMITS.files)throw talkError('첨부는 댓글마다 8개까지 추가할 수 있습니다.');
  return files.map(file=>{
    if(!file||typeof file.name!=='string'||!file.name||file.name.length>200||/[\x00-\x1f/\\]/.test(file.name)||!Number.isSafeInteger(file.size)||file.size<1||file.size>25*1024*1024||typeof file.url!=='string'||file.url.length>1024)throw talkError('첨부 파일 정보를 확인하세요.');
    const url=new URL(file.url);
    if(url.protocol!=='https:'||url.hostname!==GHES_CONFIG.host||url.username||url.password||url.search||url.hash||!/^\/[^/]+\/[^/]+\/raw\/[^/]+\/\.e2e-talk\/attachments\/[a-f\d-]{36}\/[a-f\d-]{36}\.[a-z\d]+$/i.test(url.pathname))throw talkError('첨부 파일 주소를 확인하세요.');
    return {name:file.name,size:file.size,url:url.href};
  });
}
export function joinTalkComment(text,files=[]){
  const attachments=commentAttachments(files);
  const value=String(text||'').trim();
  if(!attachments.length)return value;
  const section=`${prefix}${encodeURIComponent(JSON.stringify(attachments))} -->\n\n${attachments.map(file=>`- [${escapeName(file.name)}](${file.url})`).join('\n')}\n\n<!-- /workspace-attachments -->`;
  return (value?value+'\n\n':'')+section;
}
export function splitTalkComment(body){
  const value=String(body||'').trim(),start=value.lastIndexOf(prefix);
  if(start<0||value.length>48000)return {text:value,attachments:[]};
  try{
    const end=value.indexOf(' -->',start),attachments=commentAttachments(JSON.parse(decodeURIComponent(value.slice(start+prefix.length,end))));
    const text=value.slice(0,start).trim();
    if(joinTalkComment(text,attachments)!==value)return {text:value,attachments:[]};
    return {text,attachments};
  }catch{return {text:value,attachments:[]};}
}
export function validateTalkComment(body){
  const {text,attachments}=splitTalkComment(body);
  if((!text&&!attachments.length)||text.length>TALK_LIMITS.comment)throw talkError('댓글은 500자까지 입력하세요.');
  return body;
}
