import JSZip from 'jszip';
import path from 'node:path';
import {PersonalMail} from './helpers-personal-mail.mjs';
import {installDesktopFeatures} from '../runtime/desktop-features.mjs';
import {samplePdf} from './helpers-document-pdf.mjs';
import {PNG,xlsxFixture,pptxFixture} from './helpers-office-fixtures.mjs';
export async function mailPreviewMatrix(directory){
 const word=new JSZip();word.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');word.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word attachment evidence</w:t></w:r></w:p></w:body></w:document>');
 const samples=[
  ['memo.txt','text/plain; charset=utf-8',Buffer.from([0xc7,0xd1,0xb1,0xdb]),'한글'],
  ['note.md','text/markdown',Buffer.from('# Markdown evidence'),'Markdown evidence'],
  ['table.csv','text/csv',Buffer.concat([Buffer.from([255,254]),Buffer.from('항목,금액\n검증,100','utf16le')]),'검증'],
  ['data.json','application/json',Buffer.from('{"result":"JSON evidence"}'),'JSON evidence'],
  ['data.xml','application/xml',Buffer.from('<result>XML evidence</result>'),'XML evidence'],
  ['page.html','text/html',Buffer.from('<h1>HTML evidence</h1>'),'HTML evidence'],
  ['schedule.ics','text/calendar',Buffer.from('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Calendar evidence\r\nEND:VEVENT\r\nEND:VCALENDAR'),'Calendar evidence'],
  ['report.pdf','application/pdf',samplePdf(),'Nubi report'],
  ['report.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',await word.generateAsync({type:'nodebuffer'}),'Word attachment evidence'],
  ['report.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',await xlsxFixture(),'견'],
  ['report.pptx','application/vnd.openxmlformats-officedocument.presentationml.presentation',await pptxFixture(),''],
  ['image.png','image/png',PNG,''],
  ['message.eml','message/rfc822',Buffer.from('Subject: Nested message\r\nFrom: sender@example.test\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nNested mail evidence'),'Nested mail evidence']
 ];
 class Host{}installDesktopFeatures(Host);const host=new Host();host.storageRoot=directory;
 const mail=host.personalMail=new PersonalMail(host,{personalRoot:path.join(directory,'mail')});await mail.call({action:'setAutoWiki',enabled:false});
 const header='Subject: =?UTF-8?B?'+Buffer.from('검증 메일 0').toString('base64')+'?=\r\nFrom: test@example.test\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=parts\r\n\r\n--parts\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n첨부 파일을 선택하면 오른쪽에서 읽습니다.\r\n';
 const raw=Buffer.from(header+samples.map(([name,type,bytes])=>'--parts\r\nContent-Type: '+type+'\r\nContent-Disposition: attachment; filename="'+name+'"\r\nContent-Transfer-Encoding: base64\r\n\r\n'+bytes.toString('base64')+'\r\n').join('')+'--parts--\r\n');
 await mail.call({action:'portalConnect',identity:'fixture',folders:[]});await mail.call({action:'portalImport',uid:'portal:1:1',raw:raw.toString('base64'),size:raw.length,folder:{id:'1',mailbox:'inbox'}});
 const id=mail.rows()[0].id,requests=[];
 return {samples,requests,async request(method,args){if(method==='source')return {...await mail.read(id,{includePresentation:true}),id:'mail-0'};if(method==='mailDocument'){requests.push(args);return host.mailDocument({...args,id});}throw Error('fixture_invalid');},async dispose(){mail.dispose();await mail.rawDisposed;await mail.wikiDisposed;}};
}
