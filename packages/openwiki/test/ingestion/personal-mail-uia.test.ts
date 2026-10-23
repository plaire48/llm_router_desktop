import {test,expect} from 'vitest';
import {synthesizePersonalMail} from '../../src/ingestion/personal-mail.js';
test('UIA body evidence never becomes complete original MIME or verified empty attachments',async()=>{
 const input={subject:'UIA 수집',text:'보안 검토는 진행 중입니다.',bodySource:'uia',coverage:{scope:'open_message',completeMailbox:false,originalMimeAvailable:false,attachmentsRead:false},attachments:[]};let seen;
 const result=await synthesizePersonalMail(input,async messages=>{
  if(messages[0].content.startsWith('REVIEW_PERSONAL_MAIL')){seen=JSON.parse(messages[1].content);return {content:JSON.stringify({status:'ready',supports:[{target:'summary',source:'body',quote:input.text}]})};}
  const evidence=JSON.parse(messages[1].content);expect(evidence.coverage.complete).toBe(false);return {content:JSON.stringify({summary:input.text,category:'status',priority:'medium',facts:[],actionItems:[]})};
 },{verify:true});
 expect(result.coverage?.complete).toBe(false);expect(seen.windows.some((w:{text:string})=>w.text.includes('originalMimeAvailable'))).toBe(true);
});
