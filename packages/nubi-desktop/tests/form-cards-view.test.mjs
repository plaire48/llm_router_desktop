import test from 'node:test';
import assert from 'node:assert/strict';
import {formOutputPath,validFormOutput,formState,formSourceText,formFidelity} from '../ui/form-cards-view.mjs';
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
