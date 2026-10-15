import {mailParts} from './mail-body-images.mjs';
// Read selected attachment bytes just in time; an unfinished background index
// must not make the agent claim that a document has no content.
export async function readMailAttachmentsForAgent(service,source,references=[],signal){
  if(typeof service.mailDocument!=='function')return source;
  const selected=references.filter(item=>item.attachmentId);
  const targets=mailParts(source.mail).filter(item=>!selected.length||selected.some(ref=>ref.attachmentId===item.id));
  const updates=new Map();
  for(const attachment of targets){
    if(signal?.aborted)throw Error('cancelled');
    if(attachment.contentState==='not_stored')continue;
    if(['document_read','text_read'].includes(attachment.contentState)&&attachment.text?.trim())continue;
    try{
      const document=await service.mailDocument({id:source.id,attachmentId:attachment.id,expectedSourceHash:source.sourceHash,expectedAttachmentHash:attachment.sha256,action:'analyze',signal});
      updates.set(attachment.id,{...attachment,text:document.text,segments:document.segments,coverage:document.coverage,reader:document.image?'vision_model':attachment.reader,contentState:'document_read',error:null});
    }catch(error){
      if(signal?.aborted||['mail_source_changed','mail_cancelled','cancelled'].includes(error.message))throw error;
      updates.set(attachment.id,{...attachment,text:'',segments:[],contentState:'document_attention',error:/^(document|mail)_[a-z_]+$/.test(error.message)?error.message:'document_read_failed'});
    }
  }
  // Flatten only for model evidence so existing citation/coverage handling includes body images.
  const {inlineImages,...mail}=source.mail;
  const unread=(mail.bodyImageCoverage?.linked||0)+Math.max(0,(mail.bodyImageCoverage?.data||0)-(mail.bodyImageCoverage?.dataImages?.length||0));
  return {...source,...(unread?{imageLimitation:`${unread} body image references were displayed by the mail reader but their bytes were not available to this analysis. Do not infer their contents or claim all body images were read.`}:{}),mail:{...mail,attachments:mailParts(source.mail).map(item=>updates.get(item.id)||item)}};
}
