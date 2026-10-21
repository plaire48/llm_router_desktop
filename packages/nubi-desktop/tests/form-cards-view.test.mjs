import test from 'node:test';
import assert from 'node:assert/strict';
import {formOutputPath,validFormOutput,formState,formSourceText,formFidelity,formQuestions,formImageFiles,formQuestionPages} from '../ui/form-cards-view.mjs';
test('copy path is local-date based and rejects traversal and the source across separators',()=>{
 assert.equal(formOutputPath('합성 출장',new Date(2026,9,21)),'문서/합성 출장-2026-10-21.docx');
 for(const output of ['/a.docx','C:\\a.docx','../a.docx','a/../b.docx','a.pdf','a\\..\\b.docx'])assert.equal(validFormOutput(output,'원본.docx'),false);
 assert.equal(validFormOutput('문서/원본.docx','문서\\원본.docx'),false);
 assert.equal(validFormOutput('문서/사본.docx','원본.docx'),true);
});
test('only declared host state determines actions, never success or permission fields',()=>{
 assert.equal(formState({state:'approval',allowed:true}),'approval');
 assert.equal(formState({state:'written',checks:{failed:3}}),'written');
 assert.equal(formState({state:'applied',success:true}),'unknown');
 assert.equal(formState({canApply:true}),'unknown');
});
test('source display keeps reference and quote without inventing verification',()=>{
 assert.match(formSourceText({kind:'wiki',ref:'합성/정책',quote:'승인 후 출발'}),/합성\/정책.*승인 후 출발/);
 assert.equal(formSourceText(null),'출처 미확인');
});

test('capture fidelity reflects the host and never infers Office verification from file type',()=>{
 assert.equal(formFidelity({fidelity:'file',app:'word'}),'파일만 읽음');
 assert.equal(formFidelity({fidelity:'office',app:'excel'}),'Office로 확인함');
 assert.equal(formFidelity({app:'powerpoint'}),'읽기 출처 미확인');
});

test('question options are joined by slot only for the same source hash',()=>{
 const plan={hash:'source-a',questions:[{slot:'department',label:'부서',kind:'text',question:'어느 부서인가요?'}]};
 const metadata={hash:'source-a',questions:[{fields:[{slot:'department',kind:'text',options:['개발','운영'],freeText:true}]}]};
 assert.deepEqual(formQuestions(plan,metadata)[0],{...metadata.questions[0].fields[0],...plan.questions[0]});
 assert.equal(formQuestions({...plan,hash:'source-b'},metadata)[0].options,undefined);
 assert.equal(formQuestions({...plan,hash:undefined},metadata)[0].options,undefined);
});
test('image chooser offers only unique Workspace relative PNG and JPEG files',()=>{
 assert.deepEqual(formImageFiles(['그림/사진.png',{path:'그림/서명.JPG'},'그림/사진.png','../a.png','x/../a.png','x\\..\\a.png','/a.png','C:\\a.jpg','https://a/b.png','a.svg','~/.a.png','a\u0000.png']),['그림/사진.png','그림/서명.JPG']);
});

test('question pages keep host groups and never show more than four fields at once',()=>{
 const questions=Array.from({length:9},(_,i)=>({slot:'s'+i,label:'항목 '+i,kind:'text'}));
 const plan={hash:'same',questions};
 const metadata={hash:'same',questions:[{id:'basic',label:'기본 정보',fields:questions.slice(0,3)},{id:'details',label:'세부 내용',fields:questions.slice(3)}]};
 const pages=formQuestionPages(plan,metadata);
 assert.deepEqual(pages.map(page=>[page.title,page.questions.length]),[['기본 정보',3],['세부 내용',4],['세부 내용',2]]);
 assert.deepEqual(pages.flatMap(page=>page.questions.map(q=>q.slot)),questions.map(q=>q.slot));
 assert.deepEqual(formQuestionPages(plan,{...metadata,hash:'changed'}).map(page=>page.questions.length),[4,4,1]);
});
