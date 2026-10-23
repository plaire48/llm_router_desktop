import test from 'node:test';
import assert from 'node:assert/strict';
import {imageAttachmentType,readImageAttachment,MAX_IMAGE_BYTES} from '../runtime/mail-attachment-image.mjs';

const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
const host=(models,calls)=>({recoveryOptions:{model:{retries:0}},providers:{
  status:()=>({connected:true,provider:'chatgpt',model:'gpt-text',models}),
  complete:async(messages,_tools,_signal,_purpose,_a,_b,options)=>{calls.push({messages,options});return {content:'| 항목 | 금액 |\n| --- | --- |\n| 출장비 | 120,000 |\n\n영수증 사진입니다.',calls:[]};}
}});

test('image attachments are recognised by type or extension',()=>{
  assert.equal(imageAttachmentType('shot.PNG',''),'image/png');
  assert.equal(imageAttachmentType('photo.bin','image/jpg; charset=binary'),'image/jpeg');
  assert.equal(imageAttachmentType('Budget.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),null);
});

test('an image attachment is read by the image-capable model and becomes attachment text',async()=>{
  const calls=[];
  const document=await readImageAttachment({bytes:png,attachment:{filename:'receipt.png',contentType:'image/png'},host:host([{id:'gpt-text',supportsImages:false},{id:'gpt-vision',supportsImages:true}],calls),destination:{provider:'chatgpt',model:'gpt-text'},signal:new AbortController().signal});
  assert.equal(document.reader,'vision_model');assert.equal(document.model,'gpt-vision');assert.match(document.text,/출장비/);assert.match(document.coverage,/gpt-vision/);
  assert.equal(calls.length,1);assert.equal(calls[0].options.visionModel,'gpt-vision');assert.equal(calls[0].options.backgroundModel.model,'gpt-vision');
  const user=calls[0].messages.find(message=>message.role==='user');
  assert.equal(user.content[1].type,'image_url');assert.match(user.content[1].image_url.url,/^data:image\/png;base64,iVBOR/);
});

test('without an image-capable model, oversized or empty images, the attachment is reported, not guessed',async()=>{
  const signal=new AbortController().signal;
  await assert.rejects(readImageAttachment({bytes:png,attachment:{filename:'a.png'},host:host([{id:'gpt-text',supportsImages:false}],[]),destination:{provider:'chatgpt',model:'gpt-text'},signal}),/document_vision_unavailable/);
  await assert.rejects(readImageAttachment({bytes:Buffer.alloc(MAX_IMAGE_BYTES+1),attachment:{filename:'a.png'},host:host([{id:'gpt-vision',supportsImages:true}],[]),destination:null,signal}),/document_limit/);
  await assert.rejects(readImageAttachment({bytes:Buffer.alloc(0),attachment:{filename:'a.png'},host:host([{id:'gpt-vision',supportsImages:true}],[]),destination:null,signal}),/document_empty/);
  await assert.rejects(readImageAttachment({bytes:png,attachment:{filename:'a.txt'},host:host([],[]),destination:null,signal}),/document_format/);
});

test('background mail vision uses its own provider catalog instead of the active chat model catalog',async()=>{
 const calls=[],providers=host([{id:'chat-only',supportsImages:false}],calls);
 providers.providers.catalogs=()=>[{provider:'aipro',models:[{id:'mail-vision',supportsImages:true}]}];
 await readImageAttachment({bytes:png,attachment:{filename:'receipt.png'},host:providers,destination:{provider:'aipro',model:'mail-vision'},signal:new AbortController().signal});
 assert.equal(calls[0].options.backgroundModel.provider,'aipro');assert.equal(calls[0].options.visionModel,'mail-vision');
});


test('AI Pro GLM delegates to registered Qwen even if GLM is incorrectly marked image-capable',async()=>{
 const calls=[],glm={id:'GLM-5.2-NVFP4',supportsImages:true},qwen={id:'QWEN3.8-27B-FP8-256K'},provider=host([glm,qwen],calls);
 provider.providers.status=()=>({connected:true,provider:'aipro',model:glm.id,models:[glm,qwen]});
 await readImageAttachment({bytes:png,attachment:{filename:'body.png'},host:provider,destination:{provider:'aipro',model:glm.id},signal:new AbortController().signal});
 assert.equal(calls[0].options.visionModel,qwen.id);assert.equal(provider.providers.status().model,glm.id);
 provider.providers.status=()=>({connected:true,provider:'aipro',model:glm.id,models:[glm,{...qwen,supportsImages:false},{id:'other',supportsImages:true}]});
 await assert.rejects(readImageAttachment({bytes:png,attachment:{filename:'body.png'},host:provider,destination:{provider:'aipro',model:glm.id},signal:new AbortController().signal}),/document_vision_unavailable/);assert.equal(calls.length,1);
});
